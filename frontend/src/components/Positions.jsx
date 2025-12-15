import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ethers } from 'ethers';
import { useToast } from './Toast';

// 动态导入 SDK
let OrderBuilder, ChainId;
const loadSDK = async () => {
    if (OrderBuilder) return true;
    try {
        const sdk = await import('@predictdotfun/sdk');
        OrderBuilder = sdk.OrderBuilder;
        ChainId = sdk.ChainId;
        return true;
    } catch (err) {
        console.error('Failed to load SDK:', err);
        return false;
    }
};

const BSC_CHAIN_ID = 56;

const Positions = ({ jwtToken, userAddress, onSelectMarket, signer }) => {
    const [positions, setPositions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showAll, setShowAll] = useState(false);
    const [redeemingId, setRedeemingId] = useState(null);
    const [sdkLoaded, setSdkLoaded] = useState(false);
    
    const { showError, showSuccess } = useToast();

    // 加载 SDK
    useEffect(() => {
        loadSDK().then(success => setSdkLoaded(success));
    }, []);

    // 赎回持仓
    const handleRedeem = async (position, e) => {
        e.stopPropagation(); // 阻止触发卡片点击
        
        if (!signer) {
            showError('请先连接钱包');
            return;
        }

        const positionId = position.id || position.tokenId;
        setRedeemingId(positionId);

        try {
            // 确保 SDK 已加载
            const sdkSuccess = await loadSDK();
            if (!sdkSuccess || !OrderBuilder) {
                showError('SDK 加载失败，请刷新页面重试');
                setRedeemingId(null);
                return;
            }

            // 获取新的 signer
            const freshProvider = new ethers.BrowserProvider(window.ethereum);
            const freshSigner = await freshProvider.getSigner();

            console.log('Creating OrderBuilder with ChainId:', BSC_CHAIN_ID);
            
            // 创建 OrderBuilder
            const orderBuilder = await OrderBuilder.make(BSC_CHAIN_ID, freshSigner);

            // 打印完整的 position 数据用于调试
            console.log('Position data:', JSON.stringify(position, null, 2));

            // 获取赎回参数
            const conditionId = position.conditionId || 
                               position.market?.conditionId || 
                               position.marketDetails?.conditionId;
            
            // indexSet: 从 outcome 获取，1 = Yes, 2 = No
            const indexSet = position.outcome?.indexSet || 
                            position.indexSet || 
                            1;
            
            // amount: 赎回数量
            const amount = position.amount || 
                          position.shares || 
                          position.balance ||
                          position.size;
            
            const isNegRisk = position.isNegRisk || 
                             position.market?.isNegRisk || 
                             position.marketDetails?.negRisk ||
                             false;
            
            const isYieldBearing = position.isYieldBearing !== undefined 
                ? position.isYieldBearing 
                : (position.marketDetails?.isYieldBearing !== undefined 
                    ? position.marketDetails.isYieldBearing 
                    : true);

            console.log('Redeem params:', {
                conditionId,
                indexSet,
                amount: amount?.toString(),
                isNegRisk,
                isYieldBearing
            });

            if (!conditionId) {
                showError('无法获取 conditionId，市场数据不完整');
                setRedeemingId(null);
                return;
            }

            if (!amount) {
                showError('无法获取赎回数量');
                setRedeemingId(null);
                return;
            }

            // 跳过状态检查，直接尝试赎回（让 SDK 返回具体错误）
            const marketStatus = position.market?.status || position.marketDetails?.status;
            console.log('Market status:', marketStatus, '(跳过状态检查，直接尝试赎回)');

            const redeemParams = {
                conditionId,
                indexSet: Number(indexSet),  // SDK 可能需要数字类型
                amount: amount.toString(),
                isNegRisk,
                isYieldBearing,
            };

            console.log('Final redeemParams:', redeemParams);

            const result = await orderBuilder.redeemPositions(redeemParams);

            if (result.success) {
                showSuccess('赎回成功！');
                // 刷新持仓
                fetchPositions();
            } else {
                showError(`赎回失败: ${result.cause || '未知错误'}`);
            }
        } catch (err) {
            console.error('Redeem failed:', err);
            if (err.code === 'ACTION_REJECTED') {
                showError('用户取消了交易');
            } else if (err.message?.includes('result for condition not received yet')) {
                // 链上返回的错误：市场尚未结算
                showError('赎回失败: 市场尚未结算。请等待比赛结束并结果上链后再试。');
            } else if (err.message?.includes('Cannot convert undefined to a BigInt')) {
                // SDK 内部错误，通常是因为市场尚未结算
                const marketStatus = position.market?.status || position.marketDetails?.status || '未知';
                showError(`赎回失败: 市场尚未结算（状态: ${marketStatus}）。只有已结算的市场才能赎回。`);
            } else if (err.message?.includes('payout') || err.message?.includes('resolution')) {
                showError('赎回失败: 市场尚未结算，无法获取结算数据');
            } else {
                showError(`赎回失败: ${err.message}`);
            }
        } finally {
            setRedeemingId(null);
        }
    };

    useEffect(() => {
        if (jwtToken && userAddress) {
            fetchPositions();
            // 每 30 秒刷新一次
            const interval = setInterval(fetchPositions, 30000);
            return () => clearInterval(interval);
        }
    }, [jwtToken, userAddress]);

    const fetchPositions = async () => {
        if (!jwtToken) return;
        
        setLoading(true);
        setError('');
        
        try {
            const response = await axios.get('/api/positions', {
                headers: {
                    'Authorization': `Bearer ${jwtToken}`
                }
            });
            
            if (response.data.success) {
                const positionsData = response.data.data || [];
                
                // 为每个持仓获取当前市场价格和市场状态
                const positionsWithDetails = await Promise.all(
                    positionsData.map(async (pos) => {
                        let updatedPos = { ...pos };
                        const marketId = pos.marketId || pos.market?.id;
                        
                        if (marketId) {
                            try {
                                // 获取市场详情（包含结算状态）
                                const marketResponse = await axios.get(`/api/markets/${marketId}`);
                                if (marketResponse.data.success || marketResponse.data.data) {
                                    const marketData = marketResponse.data.data || marketResponse.data;
                                    // 判断市场是否已结算
                                    // 可能的字段: status, resolved, resolutionStatus, closed, finalized
                                    const isResolved = 
                                        marketData.status === 'RESOLVED' ||
                                        marketData.status === 'SETTLED' ||
                                        marketData.status === 'CLOSED' ||
                                        marketData.resolved === true ||
                                        marketData.finalized === true ||
                                        (marketData.resolutionStatus && marketData.resolutionStatus !== 'PENDING');
                                    
                                    updatedPos.marketDetails = marketData;
                                    updatedPos.isResolved = isResolved;
                                    updatedPos.conditionId = marketData.conditionId || pos.conditionId;
                                    updatedPos.isNegRisk = marketData.isNegRisk || marketData.negRisk || false;
                                    updatedPos.isYieldBearing = marketData.isYieldBearing !== undefined 
                                        ? marketData.isYieldBearing 
                                        : true;
                                }
                            } catch (err) {
                                console.log('Could not fetch market details:', marketId);
                            }
                            
                            try {
                                // 获取订单簿价格
                                const obResponse = await axios.get(`/api/orderbook/${marketId}`);
                                if (obResponse.data.success || obResponse.data.bids || obResponse.data.asks) {
                                    const orderBook = obResponse.data.data || obResponse.data;
                                    const bestBid = orderBook.bids?.[0]?.[0] || 0;
                                    const bestAsk = orderBook.asks?.[0]?.[0] || 0;
                                    const currentPrice = bestBid > 0 && bestAsk > 0 
                                        ? (bestBid + bestAsk) / 2 
                                        : (bestBid || bestAsk || 0);
                                    
                                    updatedPos.fetchedPrice = currentPrice;
                                }
                            } catch (err) {
                                console.log('Could not fetch orderbook for market:', marketId);
                            }
                        }
                        
                        return updatedPos;
                    })
                );
                
                setPositions(positionsWithDetails);
            } else {
                setError(response.data.error || '获取持仓失败');
            }
        } catch (err) {
            console.error('Error fetching positions:', err);
            setError(err.response?.data?.message || '获取持仓失败');
        } finally {
            setLoading(false);
        }
    };

    // Wei 转换函数
    const fromWeiLocal = (value) => {
        if (!value) return 0;
        const str = value.toString();
        if (str.length > 10) {
            return parseFloat(str) / 1e18;
        }
        return parseFloat(str);
    };

    // 计算总持仓价值
    const calculateTotalValue = () => {
        return positions.reduce((total, pos) => {
            let value = fromWeiLocal(pos.value || pos.currentValue || 0);
            // 如果没有 value，用 shares * fetchedPrice 计算
            if (value === 0) {
                const shares = fromWeiLocal(pos.shares || pos.amount || 0);
                const price = pos.fetchedPrice || 0;
                value = shares * price;
            }
            return total + value;
        }, 0);
    };

    // 计算总盈亏
    const calculateTotalPnL = () => {
        return positions.reduce((total, pos) => {
            const pnl = fromWeiLocal(pos.pnl || pos.unrealizedPnl || 0);
            return total + pnl;
        }, 0);
    };

    if (!jwtToken || !userAddress) {
        return (
            <div style={styles.container}>
                <div style={styles.header}>
                    <h3 style={styles.title}>我的持仓</h3>
                </div>
                <div style={styles.emptyState}>
                    <span style={styles.emptyIcon}>🔒</span>
                    <p style={styles.emptyText}>请连接钱包查看持仓</p>
                </div>
            </div>
        );
    }

    const displayPositions = showAll ? positions : positions.slice(0, 5);
    const totalValue = calculateTotalValue();
    const totalPnL = calculateTotalPnL();

    return (
        <div style={styles.container}>
            {/* 标题栏 */}
            <div style={styles.header}>
                <h3 style={styles.title}>我的持仓</h3>
                <button onClick={fetchPositions} style={styles.refreshBtn} disabled={loading}>
                    {loading ? '刷新中...' : '🔄 刷新'}
                </button>
            </div>

            {/* 总览 */}
            <div style={styles.summary}>
                <div style={styles.summaryItem}>
                    <span style={styles.summaryLabel}>总持仓</span>
                    <span style={styles.summaryValue}>{positions.length} 个</span>
                </div>
                <div style={styles.summaryItem}>
                    <span style={styles.summaryLabel}>总价值</span>
                    <span style={styles.summaryValue}>${totalValue.toFixed(2)}</span>
                </div>
                <div style={styles.summaryItem}>
                    <span style={styles.summaryLabel}>总盈亏</span>
                    <span style={{
                        ...styles.summaryValue,
                        color: totalPnL >= 0 ? '#4caf50' : '#f44336'
                    }}>
                        {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
                    </span>
                </div>
            </div>

            {/* 错误提示 */}
            {error && (
                <div style={styles.error}>{error}</div>
            )}

            {/* 持仓列表 */}
            {loading && positions.length === 0 ? (
                <div style={styles.loading}>加载中...</div>
            ) : positions.length === 0 ? (
                <div style={styles.emptyState}>
                    <span style={styles.emptyIcon}>📭</span>
                    <p style={styles.emptyText}>暂无持仓</p>
                </div>
            ) : (
                <>
                    <div style={styles.positionList}>
                        {displayPositions.map((position, index) => (
                            <PositionCard 
                                key={position.id || index} 
                                position={position}
                                onSelect={onSelectMarket}
                                onRedeem={handleRedeem}
                                isRedeeming={redeemingId === (position.id || position.tokenId)}
                                canRedeem={signer && sdkLoaded}
                            />
                        ))}
                    </div>

                    {/* 显示更多 */}
                    {positions.length > 5 && (
                        <button 
                            onClick={() => setShowAll(!showAll)}
                            style={styles.showMoreBtn}
                        >
                            {showAll ? '收起' : `查看全部 (${positions.length})`}
                        </button>
                    )}
                </>
            )}
        </div>
    );
};

// Wei 转换函数（18位小数）
const fromWei = (value) => {
    if (!value) return 0;
    const str = value.toString();
    // 如果是很大的数字（Wei格式），转换为正常数值
    if (str.length > 10) {
        return parseFloat(str) / 1e18;
    }
    return parseFloat(str);
};

// 单个持仓卡片
const PositionCard = ({ position, onSelect, onRedeem, isRedeeming, canRedeem }) => {
    const {
        market,
        outcome,
        shares,
        avgPrice,
        currentPrice,
        value,
        pnl,
        pnlPercent,
        marketId,
        tokenId,
        side
    } = position;

    // 检查市场是否已结算（可赎回）
    // 优先使用从 API 获取的 isResolved 状态
    const isResolved = position.isResolved === true ||
                       market?.status === 'RESOLVED' || 
                       market?.status === 'SETTLED' ||
                       market?.resolved === true || 
                       position.redeemable === true ||
                       position.marketDetails?.finalized === true;

    // 使用 fromWei 转换 Wei 格式的数值
    const displayShares = fromWei(shares || position.amount || 0);
    
    // 优先使用从订单簿获取的价格
    const displayCurrentPrice = position.fetchedPrice || fromWei(currentPrice || position.price || 0);
    
    // 价值计算：shares * currentPrice
    let displayValue = fromWei(value || position.currentValue || 0);
    if (displayValue === 0 && displayShares > 0 && displayCurrentPrice > 0) {
        // 用 shares * 当前市场价格计算
        displayValue = displayShares * displayCurrentPrice;
    }
    
    const displayPnL = fromWei(pnl || position.unrealizedPnl || 0);
    const displayPnLPercent = parseFloat(pnlPercent || 0);

    const marketTitle = market?.question || market?.title || position.marketTitle || `Market #${marketId}`;
    const outcomeName = outcome?.name || position.outcomeName || (side === 0 ? 'Yes' : 'No');

    return (
        <div 
            style={styles.positionCard}
            onClick={() => onSelect && onSelect({ id: marketId, ...market })}
        >
            {/* 市场标题 */}
            <div style={styles.positionHeader}>
                <span style={styles.positionMarket}>
                    {marketTitle.length > 40 ? marketTitle.slice(0, 40) + '...' : marketTitle}
                </span>
                <span style={{
                    ...styles.positionOutcome,
                    backgroundColor: outcomeName === 'Yes' ? '#e8f5e9' : '#ffebee',
                    color: outcomeName === 'Yes' ? '#2e7d32' : '#c62828'
                }}>
                    {outcomeName}
                </span>
            </div>

            {/* 持仓详情 */}
            <div style={styles.positionDetails}>
                <div style={styles.positionRow}>
                    <span style={styles.positionLabel}>数量</span>
                    <span style={styles.positionValue}>{displayShares.toFixed(2)} 份</span>
                </div>
                <div style={styles.positionRow}>
                    <span style={styles.positionLabel}>价值</span>
                    <span style={styles.positionValue}>${displayValue.toFixed(2)}</span>
                </div>
            </div>

            {/* 盈亏 */}
            <div style={{
                ...styles.positionPnL,
                backgroundColor: displayPnL >= 0 ? '#e8f5e9' : '#ffebee'
            }}>
                <span style={styles.pnlLabel}>盈亏</span>
                <span style={{
                    ...styles.pnlValue,
                    color: displayPnL >= 0 ? '#2e7d32' : '#c62828'
                }}>
                    {displayPnL >= 0 ? '+' : ''}{displayPnL.toFixed(2)} 
                    {displayPnLPercent !== 0 && ` (${displayPnLPercent >= 0 ? '+' : ''}${displayPnLPercent.toFixed(1)}%)`}
                </span>
            </div>

            {/* 赎回按钮 - 始终显示 */}
            {canRedeem && (
                <button
                    onClick={(e) => onRedeem(position, e)}
                    disabled={isRedeeming}
                    style={{
                        ...styles.redeemBtn,
                        opacity: isRedeeming ? 0.6 : 1,
                    }}
                >
                    {isRedeeming ? '赎回中...' : '💰 赎回'}
                </button>
            )}
        </div>
    );
};

const styles = {
    container: {
        backgroundColor: '#fff',
        borderRadius: '12px',
        padding: '16px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px'
    },
    title: {
        margin: 0,
        fontSize: '16px',
        fontWeight: '600',
        color: '#333'
    },
    refreshBtn: {
        padding: '6px 12px',
        border: '1px solid #ddd',
        borderRadius: '6px',
        backgroundColor: '#fff',
        cursor: 'pointer',
        fontSize: '12px',
        color: '#666'
    },
    summary: {
        display: 'flex',
        justifyContent: 'space-between',
        padding: '12px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
        marginBottom: '12px'
    },
    summaryItem: {
        textAlign: 'center'
    },
    summaryLabel: {
        display: 'block',
        fontSize: '11px',
        color: '#999',
        marginBottom: '4px'
    },
    summaryValue: {
        fontSize: '14px',
        fontWeight: '600',
        color: '#333'
    },
    error: {
        padding: '10px 12px',
        backgroundColor: '#ffebee',
        color: '#c62828',
        borderRadius: '8px',
        fontSize: '13px',
        marginBottom: '12px'
    },
    loading: {
        textAlign: 'center',
        padding: '20px',
        color: '#999'
    },
    emptyState: {
        textAlign: 'center',
        padding: '30px 20px'
    },
    emptyIcon: {
        fontSize: '32px',
        display: 'block',
        marginBottom: '8px'
    },
    emptyText: {
        margin: 0,
        fontSize: '13px',
        color: '#999'
    },
    positionList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
    },
    positionCard: {
        padding: '12px',
        border: '1px solid #eee',
        borderRadius: '10px',
        cursor: 'pointer',
        transition: 'all 0.2s'
    },
    positionHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '10px'
    },
    positionMarket: {
        fontSize: '13px',
        fontWeight: '500',
        color: '#333',
        flex: 1,
        marginRight: '8px'
    },
    positionOutcome: {
        padding: '3px 8px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: '500'
    },
    positionDetails: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '6px',
        marginBottom: '10px'
    },
    positionRow: {
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '12px'
    },
    positionLabel: {
        color: '#999'
    },
    positionValue: {
        color: '#333',
        fontWeight: '500'
    },
    positionPnL: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 10px',
        borderRadius: '6px'
    },
    pnlLabel: {
        fontSize: '12px',
        color: '#666'
    },
    pnlValue: {
        fontSize: '13px',
        fontWeight: '600'
    },
    showMoreBtn: {
        width: '100%',
        marginTop: '12px',
        padding: '10px',
        border: '1px solid #ddd',
        borderRadius: '8px',
        backgroundColor: '#fff',
        cursor: 'pointer',
        fontSize: '13px',
        color: '#666'
    },
    redeemBtn: {
        width: '100%',
        marginTop: '10px',
        padding: '10px',
        border: 'none',
        borderRadius: '8px',
        backgroundColor: '#4caf50',
        color: '#fff',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: '600',
        transition: 'all 0.2s'
    },
    resolvedBadge: {
        marginTop: '8px',
        padding: '4px 8px',
        backgroundColor: '#e8f5e9',
        color: '#2e7d32',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: '500',
        textAlign: 'center'
    }
};

export default Positions;
