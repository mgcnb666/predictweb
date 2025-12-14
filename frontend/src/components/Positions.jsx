import React, { useState, useEffect } from 'react';
import axios from 'axios';

const Positions = ({ jwtToken, userAddress, onSelectMarket }) => {
    const [positions, setPositions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showAll, setShowAll] = useState(false);

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
                
                // 为每个持仓获取当前市场价格
                const positionsWithPrices = await Promise.all(
                    positionsData.map(async (pos) => {
                        try {
                            const marketId = pos.marketId || pos.market?.id;
                            if (marketId) {
                                const obResponse = await axios.get(`/api/orderbook/${marketId}`);
                                if (obResponse.data.success || obResponse.data.bids || obResponse.data.asks) {
                                    const orderBook = obResponse.data.data || obResponse.data;
                                    // 获取最佳买价作为当前价格（Yes 的价格）
                                    const bestBid = orderBook.bids?.[0]?.[0] || 0;
                                    const bestAsk = orderBook.asks?.[0]?.[0] || 0;
                                    // 使用中间价或最佳买价
                                    const currentPrice = bestBid > 0 && bestAsk > 0 
                                        ? (bestBid + bestAsk) / 2 
                                        : (bestBid || bestAsk || 0);
                                    
                                    return { ...pos, fetchedPrice: currentPrice };
                                }
                            }
                        } catch (err) {
                            console.log('Could not fetch orderbook for market:', pos.marketId);
                        }
                        return pos;
                    })
                );
                
                setPositions(positionsWithPrices);
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
const PositionCard = ({ position, onSelect }) => {
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
    }
};

export default Positions;
