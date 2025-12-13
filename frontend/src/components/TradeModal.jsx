import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { ethers } from 'ethers';

// ============================================
// 使用 @predictdotfun/sdk 构建订单
// ============================================

// 动态导入 SDK (因为它可能使用 ES 模块)
let OrderBuilder, ChainId, Side, setApprovals, AddressesByChainId;

// BSC 网络配置
const BSC_CHAIN_ID = 56;
const BSC_CHAIN_ID_HEX = '0x38';
const BSC_CHAIN_CONFIG = {
    chainId: BSC_CHAIN_ID_HEX,
    chainName: 'BNB Smart Chain',
    nativeCurrency: {
        name: 'BNB',
        symbol: 'BNB',
        decimals: 18
    },
    rpcUrls: ['https://bsc-dataseed.binance.org/'],
    blockExplorerUrls: ['https://bscscan.com/']
};

const loadSDK = async () => {
    try {
        const sdk = await import('@predictdotfun/sdk');
        OrderBuilder = sdk.OrderBuilder;
        ChainId = sdk.ChainId;
        Side = sdk.Side;
        setApprovals = sdk.setApprovals;
        AddressesByChainId = sdk.AddressesByChainId;
        
        // 打印 SDK 详细信息
        console.log('=== SDK Loaded ===');
        console.log('ChainId enum:', ChainId);
        console.log('Side enum:', Side);
        console.log('AddressesByChainId:', AddressesByChainId);
        console.log('All SDK exports:', Object.keys(sdk));
        console.log('==================');
        
        return true;
    } catch (err) {
        console.error('Failed to load SDK:', err);
        return false;
    }
};

// 检查并切换到 BSC 网络
const ensureBSCNetwork = async () => {
    if (!window.ethereum) {
        throw new Error('请安装 MetaMask');
    }

    const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
    console.log('Current chainId:', currentChainId);

    if (currentChainId !== BSC_CHAIN_ID_HEX) {
        console.log('Not on BSC, switching...');
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: BSC_CHAIN_ID_HEX }]
            });
        } catch (switchError) {
            if (switchError.code === 4902) {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [BSC_CHAIN_CONFIG]
                });
            } else {
                throw new Error('请切换到 BSC 网络');
            }
        }
    }
    return true;
};

const TradeModal = ({ market, isOpen, onClose, signer, jwtToken, onTradeSuccess }) => {
    const [amount, setAmount] = useState('');
    const [price, setPrice] = useState('0.50');
    const [side, setSide] = useState('buy');
    const [outcomeIndex, setOutcomeIndex] = useState(0);
    const [orderType, setOrderType] = useState('limit');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [orderBook, setOrderBook] = useState(null);
    const [error, setError] = useState('');
    const [userAddress, setUserAddress] = useState('');
    const [sdkLoaded, setSdkLoaded] = useState(false);
    const [orderBuilder, setOrderBuilder] = useState(null);
    const [isApproving, setIsApproving] = useState(false);
    const [approvalStatus, setApprovalStatus] = useState(null); // null, 'pending', 'approved', 'error'

    // 加载 SDK
    useEffect(() => {
        loadSDK().then(success => {
            setSdkLoaded(success);
            if (!success) {
                setError('SDK 加载失败，请检查依赖是否安装');
            }
        });
    }, []);

    // 初始化 OrderBuilder
    useEffect(() => {
        const initOrderBuilder = async () => {
            if (!sdkLoaded || !signer || !OrderBuilder) return;
            
            try {
                // 使用 BSC 主网 (chainId: 56)
                console.log('Initializing OrderBuilder with BSC chainId:', BSC_CHAIN_ID);
                
                const builder = await OrderBuilder.make(BSC_CHAIN_ID, signer);
                setOrderBuilder(builder);
                console.log('OrderBuilder initialized successfully');
            } catch (err) {
                console.error('Failed to initialize OrderBuilder:', err);
                setError(`OrderBuilder 初始化失败: ${err.message}`);
            }
        };
        
        initOrderBuilder();
    }, [sdkLoaded, signer]);

    // 获取用户地址
    useEffect(() => {
        const getAddress = async () => {
            if (signer) {
                const addr = await signer.getAddress();
                setUserAddress(addr);
            }
        };
        getAddress();
    }, [signer]);

    // 获取订单簿
    useEffect(() => {
        if (isOpen && market?.id) {
            fetchOrderBook();
            const interval = setInterval(fetchOrderBook, 3000);
            return () => clearInterval(interval);
        }
    }, [isOpen, market?.id]);

    const fetchOrderBook = async () => {
        if (!market?.id) return;
        try {
            const response = await axios.get(`/api/orderbook/${market.id}`);
            if (response.data.success) {
                setOrderBook(response.data.data);
            }
        } catch (err) {
            console.error('Error fetching orderbook:', err);
        }
    };

    // 处理授权 (Approve USDT & ConditionalTokens) - 使用 SDK
    const handleApproval = async () => {
        if (!sdkLoaded) {
            setError('请等待 SDK 加载');
            return;
        }

        setIsApproving(true);
        setApprovalStatus('pending');
        setError('');

        try {
            // 确保在 BSC 网络上
            await ensureBSCNetwork();
            
            // 重新获取最新的 signer
            const freshProvider = new ethers.BrowserProvider(window.ethereum);
            const freshSigner = await freshProvider.getSigner();
            console.log('Using fresh signer for approval');
            
            // 使用 BSC 主网 (chainId: 56)
            const chainId = BSC_CHAIN_ID;
            console.log('Setting approvals for BSC chainId:', chainId);
            
            // 打印 SDK 中可用的地址信息
            if (AddressesByChainId) {
                console.log('Available addresses from SDK:', AddressesByChainId[chainId]);
            }

            // 直接使用手动授权方式（更可控）
            await manualApprovalWithSDK(chainId, freshSigner);
            
        } catch (err) {
            console.error('Approval failed:', err);
            setApprovalStatus('error');
            
            if (err.code === 'ACTION_REJECTED') {
                setError('用户拒绝授权交易');
            } else {
                setError(`授权失败: ${err.message}`);
            }
        } finally {
            setIsApproving(false);
        }
    };

    // 使用 SDK 地址手动授权
    const manualApprovalWithSDK = async (chainId, freshSigner) => {
        // 从 SDK 获取所有地址
        const addresses = AddressesByChainId ? AddressesByChainId[chainId] : null;
        
        console.log('SDK Addresses for chainId', chainId, ':', addresses);

        // 如果 SDK 没有地址，使用备用地址
        let CTF_EXCHANGE, NEG_RISK_CTF_EXCHANGE, USDT, CONDITIONAL_TOKENS, NEG_RISK_ADAPTER;
        
        if (addresses) {
            CTF_EXCHANGE = addresses.CTF_EXCHANGE;
            NEG_RISK_CTF_EXCHANGE = addresses.NEG_RISK_CTF_EXCHANGE;
            USDT = addresses.USDT || addresses.COLLATERAL; // 可能叫 COLLATERAL
            CONDITIONAL_TOKENS = addresses.CONDITIONAL_TOKENS;
            NEG_RISK_ADAPTER = addresses.NEG_RISK_ADAPTER;
        }

        // 打印所有可用的地址键
        if (addresses) {
            console.log('Available address keys:', Object.keys(addresses));
            console.log('NEG_RISK_ADAPTER:', NEG_RISK_ADAPTER);
        }

        if (!CTF_EXCHANGE || !USDT) {
            throw new Error(`无法从 SDK 获取合约地址。CTF_EXCHANGE: ${CTF_EXCHANGE}, USDT: ${USDT}。请在 predict.fun 官网授权。`);
        }

        // 使用传入的 freshSigner
        const signerToUse = freshSigner || signer;
        
        console.log('Using addresses:');
        console.log('  USDT:', USDT);
        console.log('  CTF_EXCHANGE:', CTF_EXCHANGE);
        console.log('  NEG_RISK_CTF_EXCHANGE:', NEG_RISK_CTF_EXCHANGE);
        console.log('  CONDITIONAL_TOKENS:', CONDITIONAL_TOKENS);
        console.log('  NEG_RISK_ADAPTER:', NEG_RISK_ADAPTER);

        // ERC20 approve ABI
        const ERC20_ABI = [
            'function approve(address spender, uint256 amount) returns (bool)',
            'function allowance(address owner, address spender) view returns (uint256)'
        ];

        const maxAmount = ethers.MaxUint256;
        const userAddr = await signerToUse.getAddress();

        // 1. 检查并授权 USDT 给 CTF_EXCHANGE
        console.log('Checking USDT allowance for CTF_EXCHANGE...');
        const usdtContract = new ethers.Contract(USDT, ERC20_ABI, signerToUse);
        
        try {
            const allowance1 = await usdtContract.allowance(userAddr, CTF_EXCHANGE);
            console.log('Current USDT allowance for CTF_EXCHANGE:', allowance1.toString());
            
            if (allowance1 < maxAmount / 2n) {
                console.log('Approving USDT for CTF_EXCHANGE...');
                const tx1 = await usdtContract.approve(CTF_EXCHANGE, maxAmount);
                await tx1.wait();
                console.log('USDT approved for CTF_EXCHANGE ✓');
            } else {
                console.log('USDT already approved for CTF_EXCHANGE ✓');
            }
        } catch (err) {
            console.error('Error with CTF_EXCHANGE approval:', err);
            // 直接尝试授权，不检查
            console.log('Trying direct approval for CTF_EXCHANGE...');
            const tx1 = await usdtContract.approve(CTF_EXCHANGE, maxAmount);
            await tx1.wait();
            console.log('USDT approved for CTF_EXCHANGE ✓');
        }

        // 2. 授权 USDT 给 NEG_RISK_CTF_EXCHANGE (如果存在且不同)
        if (NEG_RISK_CTF_EXCHANGE && NEG_RISK_CTF_EXCHANGE !== CTF_EXCHANGE) {
            try {
                const allowance2 = await usdtContract.allowance(userAddr, NEG_RISK_CTF_EXCHANGE);
                console.log('Current USDT allowance for NEG_RISK_CTF_EXCHANGE:', allowance2.toString());
                
                if (allowance2 < maxAmount / 2n) {
                    console.log('Approving USDT for NEG_RISK_CTF_EXCHANGE...');
                    const tx2 = await usdtContract.approve(NEG_RISK_CTF_EXCHANGE, maxAmount);
                    await tx2.wait();
                    console.log('USDT approved for NEG_RISK_CTF_EXCHANGE ✓');
                } else {
                    console.log('USDT already approved for NEG_RISK_CTF_EXCHANGE ✓');
                }
            } catch (err) {
                console.error('Error with NEG_RISK approval:', err);
                const tx2 = await usdtContract.approve(NEG_RISK_CTF_EXCHANGE, maxAmount);
                await tx2.wait();
                console.log('USDT approved for NEG_RISK_CTF_EXCHANGE ✓');
            }
        }

        // 2.5 授权 USDT 给 NEG_RISK_ADAPTER (NegRisk 市场必需)
        if (NEG_RISK_ADAPTER) {
            try {
                const allowance3 = await usdtContract.allowance(userAddr, NEG_RISK_ADAPTER);
                console.log('Current USDT allowance for NEG_RISK_ADAPTER:', allowance3.toString());
                
                if (allowance3 < maxAmount / 2n) {
                    console.log('Approving USDT for NEG_RISK_ADAPTER...');
                    const tx3 = await usdtContract.approve(NEG_RISK_ADAPTER, maxAmount);
                    await tx3.wait();
                    console.log('USDT approved for NEG_RISK_ADAPTER ✓');
                } else {
                    console.log('USDT already approved for NEG_RISK_ADAPTER ✓');
                }
            } catch (err) {
                console.error('Error with NEG_RISK_ADAPTER approval:', err);
                try {
                    const tx3 = await usdtContract.approve(NEG_RISK_ADAPTER, maxAmount);
                    await tx3.wait();
                    console.log('USDT approved for NEG_RISK_ADAPTER ✓');
                } catch (innerErr) {
                    console.warn('Could not approve NEG_RISK_ADAPTER:', innerErr.message);
                }
            }
        }

        // 3. 授权 ConditionalTokens (ERC1155) - 可选，卖出时需要
        if (CONDITIONAL_TOKENS) {
            try {
                // ERC1155 setApprovalForAll ABI
                const ERC1155_ABI = [
                    'function setApprovalForAll(address operator, bool approved)',
                    'function isApprovedForAll(address account, address operator) view returns (bool)'
                ];

                const ctContract = new ethers.Contract(CONDITIONAL_TOKENS, ERC1155_ABI, signerToUse);
                
                // 检查是否已授权
                let isApproved = false;
                try {
                    isApproved = await ctContract.isApprovedForAll(userAddr, CTF_EXCHANGE);
                } catch (checkErr) {
                    console.log('Could not check ERC1155 approval status, will try to approve');
                }

                if (!isApproved) {
                    console.log('Approving ConditionalTokens for CTF_EXCHANGE...');
                    const tx3 = await ctContract.setApprovalForAll(CTF_EXCHANGE, true);
                    await tx3.wait();
                    console.log('ConditionalTokens approved for CTF_EXCHANGE ✓');
                } else {
                    console.log('ConditionalTokens already approved for CTF_EXCHANGE ✓');
                }

                // NEG_RISK_CTF_EXCHANGE
                if (NEG_RISK_CTF_EXCHANGE && NEG_RISK_CTF_EXCHANGE !== CTF_EXCHANGE) {
                    let isApproved2 = false;
                    try {
                        isApproved2 = await ctContract.isApprovedForAll(userAddr, NEG_RISK_CTF_EXCHANGE);
                    } catch (checkErr) {
                        console.log('Could not check NEG_RISK ERC1155 approval');
                    }

                    if (!isApproved2) {
                        console.log('Approving ConditionalTokens for NEG_RISK_CTF_EXCHANGE...');
                        const tx4 = await ctContract.setApprovalForAll(NEG_RISK_CTF_EXCHANGE, true);
                        await tx4.wait();
                        console.log('ConditionalTokens approved for NEG_RISK_CTF_EXCHANGE ✓');
                    }
                }

                // NEG_RISK_ADAPTER - 必须授权才能在 NegRisk 市场交易
                if (NEG_RISK_ADAPTER) {
                    let isApproved3 = false;
                    try {
                        isApproved3 = await ctContract.isApprovedForAll(userAddr, NEG_RISK_ADAPTER);
                    } catch (checkErr) {
                        console.log('Could not check NEG_RISK_ADAPTER ERC1155 approval');
                    }

                    if (!isApproved3) {
                        console.log('Approving ConditionalTokens for NEG_RISK_ADAPTER...');
                        const tx5 = await ctContract.setApprovalForAll(NEG_RISK_ADAPTER, true);
                        await tx5.wait();
                        console.log('ConditionalTokens approved for NEG_RISK_ADAPTER ✓');
                    } else {
                        console.log('ConditionalTokens already approved for NEG_RISK_ADAPTER ✓');
                    }
                }
            } catch (err) {
                // ERC1155 授权失败不是致命错误，买入操作只需要 USDT 授权
                console.warn('ConditionalTokens approval failed (not critical for buying):', err.message);
            }
        }

        setApprovalStatus('approved');
        alert('授权成功！USDT 已授权，可以进行买入操作。');
    };

    // 获取最佳价格
    const getBestPrices = () => {
        if (!orderBook) return { bestBid: null, bestAsk: null };
        
        const bids = orderBook.bids || [];
        const asks = orderBook.asks || [];
        
        if (outcomeIndex === 0) {
            return {
                bestBid: bids[0]?.[0],
                bestAsk: asks[0]?.[0]
            };
        } else {
            return {
                bestBid: asks[0] ? 1 - asks[0][0] : null,
                bestAsk: bids[0] ? 1 - bids[0][0] : null
            };
        }
    };

    const { bestBid, bestAsk } = getBestPrices();

    const setToBestPrice = (type) => {
        if (type === 'bid' && bestBid) {
            setPrice(bestBid.toFixed(2));
        } else if (type === 'ask' && bestAsk) {
            setPrice(bestAsk.toFixed(2));
        }
    };

    const calculateEstimate = () => {
        const qty = parseFloat(amount) || 0;
        const p = parseFloat(price) || 0;
        return (qty * p).toFixed(2);
    };

    if (!isOpen || !market) return null;

    const handleTrade = async () => {
        setError('');
        
        if (!signer) {
            setError('请先连接钱包');
            return;
        }

        if (!jwtToken) {
            setError('请先认证（重新连接钱包）');
            return;
        }

        if (!userAddress) {
            setError('无法获取钱包地址');
            return;
        }

        if (!sdkLoaded || !OrderBuilder || !Side) {
            setError('SDK 未加载，请刷新页面');
            return;
        }

        if (!amount || parseFloat(amount) <= 0) {
            setError('请输入有效数量');
            return;
        }

        if (orderType === 'limit' && (!price || parseFloat(price) <= 0 || parseFloat(price) >= 1)) {
            setError('价格必须在 0 到 1 之间');
            return;
        }

        setIsSubmitting(true);

        try {
            // 0. 确保在 BSC 网络上
            await ensureBSCNetwork();

            // 0.1 重新获取最新的 signer (确保网络切换后使用正确的 signer)
            const freshProvider = new ethers.BrowserProvider(window.ethereum);
            const freshSigner = await freshProvider.getSigner();
            const freshAddress = await freshSigner.getAddress();
            console.log('Using fresh signer for address:', freshAddress);

            // 1. 获取选中的 outcome
            const selectedOutcome = market.outcomesDetail?.[outcomeIndex] || {};
            const tokenId = selectedOutcome.onChainId || '0';
            
            console.log('Selected outcome:', selectedOutcome);
            console.log('Token ID:', tokenId);

            // 2. 准备价格和数量 (Wei 格式，18 位小数)
            // 价格精度必须是 2 位小数
            const priceValue = Math.round(parseFloat(price) * 100) / 100;
            const amountValue = parseFloat(amount);
            
            console.log('Price after rounding to 2 decimals:', priceValue);
            
            // 转换为 Wei (BigInt)
            const pricePerShareWei = ethers.parseUnits(priceValue.toFixed(2), 18);
            const quantityWei = ethers.parseUnits(amountValue.toFixed(18), 18);
            
            console.log('Price per share (Wei):', pricePerShareWei.toString());
            console.log('Quantity (Wei):', quantityWei.toString());

            // 3. 确定买卖方向
            const orderSide = side === 'buy' ? Side.BUY : Side.SELL;
            console.log('Order side:', orderSide);

            // 4. 创建 OrderBuilder (使用最新的 signer) - BSC 主网
            const chainId = BSC_CHAIN_ID;
            console.log('Creating OrderBuilder with BSC chainId:', chainId);
            
            const builder = await OrderBuilder.make(chainId, freshSigner);
            console.log('OrderBuilder created with fresh signer');

            // 5. 计算订单金额 (使用 SDK)
            let amounts;
            let order;
            
            if (orderType === 'limit') {
                // 限价单
                amounts = builder.getLimitOrderAmounts({
                    side: orderSide,
                    pricePerShareWei: pricePerShareWei,
                    quantityWei: quantityWei
                });
                
                console.log('Limit order amounts:', {
                    pricePerShare: amounts.pricePerShare.toString(),
                    makerAmount: amounts.makerAmount.toString(),
                    takerAmount: amounts.takerAmount.toString()
                });

                // 6. 构建限价订单
                order = builder.buildOrder("LIMIT", {
                    maker: freshAddress,
                    signer: freshAddress,
                    side: orderSide,
                    tokenId: tokenId,
                    makerAmount: amounts.makerAmount,
                    takerAmount: amounts.takerAmount,
                    nonce: 0n,
                    feeRateBps: market.feeRateBps || 100
                });
            } else {
                // 市价单 - 需要先获取订单簿
                console.log('Processing market order, fetching orderbook...');
                
                // 获取当前订单簿
                let orderBookData;
                try {
                    const obResponse = await axios.get(`/api/orderbook/${market.id}`);
                    if (obResponse.data.success && obResponse.data.data) {
                        orderBookData = obResponse.data.data;
                    } else if (obResponse.data.asks || obResponse.data.bids) {
                        orderBookData = obResponse.data;
                    }
                } catch (obErr) {
                    console.error('Failed to fetch orderbook:', obErr);
                }
                
                // 检查订单簿是否有足够的流动性
                if (!orderBookData || 
                    (!orderBookData.asks?.length && !orderBookData.bids?.length)) {
                    throw new Error('订单簿为空，无法执行市价单。请使用限价单。');
                }
                
                console.log('Orderbook fetched:', {
                    asks: orderBookData.asks?.length || 0,
                    bids: orderBookData.bids?.length || 0
                });

                // 使用 getMarketOrderAmounts（需要传入订单簿）
                if (typeof builder.getMarketOrderAmounts === 'function') {
                    try {
                        amounts = builder.getMarketOrderAmounts({
                            side: orderSide,
                            quantityWei: quantityWei,
                            book: orderBookData
                        });
                    } catch (marketErr) {
                        console.error('getMarketOrderAmounts failed:', marketErr);
                        // 回退到限价单逻辑
                        const marketPriceWei = orderSide === Side.BUY 
                            ? ethers.parseUnits("0.99", 18)
                            : ethers.parseUnits("0.01", 18);
                        
                        amounts = builder.getLimitOrderAmounts({
                            side: orderSide,
                            pricePerShareWei: marketPriceWei,
                            quantityWei: quantityWei
                        });
                    }
                } else {
                    // SDK 没有 getMarketOrderAmounts，使用限价单逻辑
                    const marketPriceWei = orderSide === Side.BUY 
                        ? ethers.parseUnits("0.99", 18)
                        : ethers.parseUnits("0.01", 18);
                    
                    amounts = builder.getLimitOrderAmounts({
                        side: orderSide,
                        pricePerShareWei: marketPriceWei,
                        quantityWei: quantityWei
                    });
                }
                
                console.log('Market order amounts:', {
                    makerAmount: amounts.makerAmount.toString(),
                    takerAmount: amounts.takerAmount.toString()
                });

                // 6. 构建市价订单
                order = builder.buildOrder("MARKET", {
                    maker: freshAddress,
                    signer: freshAddress,
                    side: orderSide,
                    tokenId: tokenId,
                    makerAmount: amounts.makerAmount,
                    takerAmount: amounts.takerAmount,
                    nonce: 0n,
                    feeRateBps: market.feeRateBps || 100
                });
            }
            
            console.log('Built order:', order, 'Type:', orderType);

            // 7. 构建 EIP-712 类型数据
            const isNegRisk = market.isNegRisk || false;
            const typedData = builder.buildTypedData(order, { isNegRisk });
            
            console.log('=== DEBUG: Typed Data ===');
            console.log('Domain:', JSON.stringify(typedData.domain, null, 2));
            console.log('Types:', JSON.stringify(typedData.types, null, 2));
            console.log('Primary Type:', typedData.primaryType);
            console.log('Message:', JSON.stringify(typedData.message, null, 2));
            console.log('isNegRisk:', isNegRisk);
            console.log('=========================');

            // 8. 签名订单 (使用 SDK)
            const signedOrder = await builder.signTypedDataOrder(typedData);
            
            console.log('Signed order:', signedOrder);
            console.log('Signature:', signedOrder.signature);

            // 9. 计算订单哈希
            const orderHash = builder.buildTypedDataHash(typedData);
            
            console.log('Order hash:', orderHash);

            // 10. 构建请求数据
            const requestData = {
                data: {
                    // 市价单可能没有 pricePerShare
                    pricePerShare: amounts.pricePerShare ? amounts.pricePerShare.toString() : "0",
                    strategy: orderType.toUpperCase(),
                    order: {
                        hash: orderHash,
                        salt: signedOrder.salt.toString(),
                        maker: signedOrder.maker,
                        signer: signedOrder.signer,
                        taker: signedOrder.taker,
                        tokenId: signedOrder.tokenId.toString(),
                        makerAmount: signedOrder.makerAmount.toString(),
                        takerAmount: signedOrder.takerAmount.toString(),
                        expiration: signedOrder.expiration.toString(),
                        nonce: signedOrder.nonce.toString(),
                        feeRateBps: signedOrder.feeRateBps.toString(),
                        side: signedOrder.side,
                        signatureType: signedOrder.signatureType,
                        signature: signedOrder.signature
                    }
                }
            };

            console.log('Submitting order:', JSON.stringify(requestData, null, 2));

            // 11. 提交订单到后端
            const response = await axios.post('/api/orders', requestData, {
                headers: {
                    'Authorization': `Bearer ${jwtToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.success) {
                alert(`订单提交成功！\n订单哈希: ${orderHash}`);
                onTradeSuccess && onTradeSuccess(response.data);
                onClose();
            } else {
                // 优先显示详细错误描述
                const errorDesc = response.data.error?.description || 
                                  response.data.error || 
                                  response.data.message || 
                                  '订单提交失败';
                setError(errorDesc);
            }
        } catch (err) {
            console.error('Trade failed:', err);
            if (err.code === 'ACTION_REJECTED') {
                setError('用户拒绝签名');
            } else {
                // 优先显示详细错误描述
                const errorData = err.response?.data;
                const errorDesc = errorData?.error?.description || 
                                  errorData?.error || 
                                  errorData?.message || 
                                  err.message || 
                                  '订单提交失败';
                setError(errorDesc);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const getOutcomeName = (idx) => {
        if (market.outcomesDetail?.[idx]?.name) {
            return market.outcomesDetail[idx].name;
        }
        return market.outcomes?.[idx] || `Outcome ${idx}`;
    };

    return (
        <div style={styles.overlay}>
            <div style={styles.modal}>
                {/* 标题 */}
                <div style={styles.header}>
                    <h2 style={styles.title}>交易</h2>
                    <button onClick={onClose} style={styles.closeBtn}>×</button>
                </div>

                {/* 市场信息 */}
                <div style={styles.marketInfo}>
                    <span style={styles.marketQuestion}>{market.question || market.title}</span>
                </div>

                {/* SDK 状态 */}
                <div style={{
                    ...styles.sdkStatus,
                    backgroundColor: sdkLoaded ? '#e8f5e9' : '#fff3e0',
                    color: sdkLoaded ? '#2e7d32' : '#e65100'
                }}>
                    {sdkLoaded ? '✓ SDK 已加载' : '⏳ SDK 加载中...'}
                </div>

                {/* 错误提示 */}
                {error && (
                    <div style={styles.errorBanner}>{error}</div>
                )}

                {/* 认证状态 */}
                {!jwtToken && (
                    <div style={styles.warningBanner}>
                        ⚠️ 请连接钱包并认证以进行交易
                    </div>
                )}

                {/* 钱包地址 */}
                {userAddress && (
                    <div style={styles.addressBanner}>
                        钱包: {userAddress.slice(0, 6)}...{userAddress.slice(-4)}
                    </div>
                )}

                {/* 授权按钮 */}
                {signer && sdkLoaded && (
                    <div style={styles.approvalSection}>
                        <div style={styles.approvalInfo}>
                            <span style={styles.approvalLabel}>代币授权:</span>
                            <span style={{
                                ...styles.approvalStatusText,
                                color: approvalStatus === 'approved' ? '#2e7d32' : 
                                       approvalStatus === 'error' ? '#c62828' : '#666'
                            }}>
                                {approvalStatus === 'approved' ? '✓ 已授权' : 
                                 approvalStatus === 'error' ? '✗ 授权失败' : 
                                 approvalStatus === 'pending' ? '⏳ 授权中...' : '未授权'}
                            </span>
                        </div>
                        <button
                            onClick={handleApproval}
                            disabled={isApproving || approvalStatus === 'approved'}
                            style={{
                                ...styles.approvalBtn,
                                opacity: (isApproving || approvalStatus === 'approved') ? 0.6 : 1,
                                backgroundColor: approvalStatus === 'approved' ? '#4caf50' : '#ff9800'
                            }}
                        >
                            {isApproving ? '授权中...' : 
                             approvalStatus === 'approved' ? '已授权 ✓' : '授权 USDT'}
                        </button>
                        <div style={styles.approvalHint}>
                            首次交易前需要授权 USDT
                        </div>
                    </div>
                )}

                {/* 订单类型 */}
                <div style={styles.formGroup}>
                    <label style={styles.label}>订单类型</label>
                    <div style={styles.toggleGroup}>
                        <button
                            onClick={() => setOrderType('limit')}
                            style={{
                                ...styles.toggleBtn,
                                backgroundColor: orderType === 'limit' ? '#1976d2' : '#f5f5f5',
                                color: orderType === 'limit' ? '#fff' : '#333'
                            }}
                        >
                            限价单
                        </button>
                        <button
                            onClick={() => setOrderType('market')}
                            style={{
                                ...styles.toggleBtn,
                                backgroundColor: orderType === 'market' ? '#1976d2' : '#f5f5f5',
                                color: orderType === 'market' ? '#fff' : '#333'
                            }}
                        >
                            市价单
                        </button>
                    </div>
                </div>

                {/* Outcome 选择 */}
                <div style={styles.formGroup}>
                    <label style={styles.label}>结果</label>
                    <div style={styles.toggleGroup}>
                        {(market.outcomes || ['Yes', 'No']).map((outcome, idx) => (
                            <button
                                key={idx}
                                onClick={() => setOutcomeIndex(idx)}
                                style={{
                                    ...styles.toggleBtn,
                                    backgroundColor: outcomeIndex === idx 
                                        ? (idx === 0 ? '#4caf50' : '#f44336')
                                        : '#f5f5f5',
                                    color: outcomeIndex === idx ? '#fff' : '#333'
                                }}
                            >
                                {getOutcomeName(idx)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Buy/Sell */}
                <div style={styles.formGroup}>
                    <label style={styles.label}>买卖方向</label>
                    <div style={styles.toggleGroup}>
                        <button
                            onClick={() => setSide('buy')}
                            style={{
                                ...styles.toggleBtn,
                                backgroundColor: side === 'buy' ? '#4caf50' : '#e8f5e9',
                                color: side === 'buy' ? '#fff' : '#2e7d32'
                            }}
                        >
                            买入
                        </button>
                        <button
                            onClick={() => setSide('sell')}
                            style={{
                                ...styles.toggleBtn,
                                backgroundColor: side === 'sell' ? '#f44336' : '#ffebee',
                                color: side === 'sell' ? '#fff' : '#c62828'
                            }}
                        >
                            卖出
                        </button>
                    </div>
                </div>

                {/* 订单簿价格参考 */}
                {orderBook && (
                    <div style={styles.priceReference}>
                        <div style={styles.priceRefItem}>
                            <span style={styles.priceRefLabel}>最佳买价:</span>
                            <span 
                                style={styles.priceRefValueBid}
                                onClick={() => setToBestPrice('bid')}
                            >
                                {bestBid ? `$${bestBid.toFixed(2)}` : '-'}
                            </span>
                        </div>
                        <div style={styles.priceRefItem}>
                            <span style={styles.priceRefLabel}>最佳卖价:</span>
                            <span 
                                style={styles.priceRefValueAsk}
                                onClick={() => setToBestPrice('ask')}
                            >
                                {bestAsk ? `$${bestAsk.toFixed(2)}` : '-'}
                            </span>
                        </div>
                    </div>
                )}

                {/* 价格输入 */}
                {orderType === 'limit' && (
                    <div style={styles.formGroup}>
                        <label style={styles.label}>价格 (0-1)</label>
                        <div style={styles.inputWrapper}>
                            <span style={styles.inputPrefix}>$</span>
                            <input
                                type="number"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                min="0.01"
                                max="0.99"
                                step="0.01"
                                style={styles.input}
                            />
                        </div>
                        <div style={styles.quickPrices}>
                            {[0.1, 0.25, 0.5, 0.75, 0.9].map(p => (
                                <button
                                    key={p}
                                    onClick={() => setPrice(p.toString())}
                                    style={styles.quickPriceBtn}
                                >
                                    {p}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* 数量输入 */}
                <div style={styles.formGroup}>
                    <label style={styles.label}>数量 (份额)</label>
                    <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        min="1"
                        placeholder="输入数量"
                        style={styles.inputFull}
                    />
                    <div style={styles.quickAmounts}>
                        {[10, 50, 100, 500, 1000].map(a => (
                            <button
                                key={a}
                                onClick={() => setAmount(a.toString())}
                                style={styles.quickAmountBtn}
                            >
                                {a}
                            </button>
                        ))}
                    </div>
                </div>

                {/* 预估 */}
                <div style={styles.estimate}>
                    <div style={styles.estimateRow}>
                        <span>预估 {side === 'buy' ? '成本' : '收益'}:</span>
                        <span style={styles.estimateValue}>${calculateEstimate()} USDT</span>
                    </div>
                    {market.feeRateBps && (
                        <div style={styles.estimateRow}>
                            <span>手续费 ({market.feeRateBps / 100}%):</span>
                            <span>${(parseFloat(calculateEstimate()) * market.feeRateBps / 10000).toFixed(4)}</span>
                        </div>
                    )}
                </div>

                {/* 按钮 */}
                <div style={styles.actions}>
                    <button onClick={onClose} style={styles.cancelBtn}>
                        取消
                    </button>
                    <button
                        onClick={handleTrade}
                        disabled={isSubmitting || !jwtToken || !sdkLoaded}
                        style={{
                            ...styles.submitBtn,
                            backgroundColor: side === 'buy' ? '#4caf50' : '#f44336',
                            opacity: (isSubmitting || !jwtToken || !sdkLoaded) ? 0.6 : 1
                        }}
                    >
                        {isSubmitting ? '签名中...' : `${side === 'buy' ? '买入' : '卖出'} ${getOutcomeName(outcomeIndex)}`}
                    </button>
                </div>
            </div>
        </div>
    );
};

const styles = {
    overlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000
    },
    modal: {
        backgroundColor: '#fff',
        borderRadius: '16px',
        width: '420px',
        maxWidth: '95vw',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px 20px',
        borderBottom: '1px solid #eee'
    },
    title: {
        margin: 0,
        fontSize: '18px',
        fontWeight: '600',
        color: '#333'
    },
    closeBtn: {
        background: 'none',
        border: 'none',
        fontSize: '24px',
        cursor: 'pointer',
        color: '#666',
        padding: '0 8px'
    },
    marketInfo: {
        padding: '12px 20px',
        backgroundColor: '#f8f9fa'
    },
    marketQuestion: {
        fontSize: '14px',
        color: '#333',
        fontWeight: '500'
    },
    sdkStatus: {
        margin: '8px 20px',
        padding: '8px 12px',
        borderRadius: '8px',
        fontSize: '12px',
        textAlign: 'center'
    },
    errorBanner: {
        margin: '12px 20px',
        padding: '10px 12px',
        backgroundColor: '#ffebee',
        color: '#c62828',
        borderRadius: '8px',
        fontSize: '13px'
    },
    warningBanner: {
        margin: '12px 20px',
        padding: '10px 12px',
        backgroundColor: '#fff3e0',
        color: '#e65100',
        borderRadius: '8px',
        fontSize: '13px'
    },
    addressBanner: {
        margin: '0 20px 12px',
        padding: '8px 12px',
        backgroundColor: '#e3f2fd',
        color: '#1976d2',
        borderRadius: '8px',
        fontSize: '12px',
        fontFamily: 'monospace'
    },
    approvalSection: {
        margin: '12px 20px',
        padding: '12px',
        backgroundColor: '#fff8e1',
        borderRadius: '8px',
        border: '1px solid #ffe082'
    },
    approvalInfo: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '8px'
    },
    approvalLabel: {
        fontSize: '13px',
        fontWeight: '500',
        color: '#666'
    },
    approvalStatusText: {
        fontSize: '12px',
        fontWeight: '500'
    },
    approvalBtn: {
        width: '100%',
        padding: '10px',
        border: 'none',
        borderRadius: '8px',
        color: '#fff',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: '500',
        marginBottom: '6px'
    },
    approvalHint: {
        fontSize: '11px',
        color: '#999',
        textAlign: 'center'
    },
    formGroup: {
        padding: '12px 20px'
    },
    label: {
        display: 'block',
        marginBottom: '8px',
        fontSize: '13px',
        fontWeight: '500',
        color: '#666'
    },
    toggleGroup: {
        display: 'flex',
        gap: '8px'
    },
    toggleBtn: {
        flex: 1,
        padding: '10px 16px',
        border: 'none',
        borderRadius: '8px',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: '500',
        transition: 'all 0.2s'
    },
    priceReference: {
        display: 'flex',
        justifyContent: 'space-around',
        padding: '8px 20px',
        backgroundColor: '#fafafa',
        borderTop: '1px solid #eee',
        borderBottom: '1px solid #eee'
    },
    priceRefItem: {
        textAlign: 'center'
    },
    priceRefLabel: {
        fontSize: '11px',
        color: '#999',
        display: 'block'
    },
    priceRefValueBid: {
        fontSize: '14px',
        fontWeight: '600',
        color: '#4caf50',
        cursor: 'pointer'
    },
    priceRefValueAsk: {
        fontSize: '14px',
        fontWeight: '600',
        color: '#f44336',
        cursor: 'pointer'
    },
    inputWrapper: {
        display: 'flex',
        alignItems: 'center',
        border: '1px solid #ddd',
        borderRadius: '8px',
        overflow: 'hidden'
    },
    inputPrefix: {
        padding: '12px',
        backgroundColor: '#f5f5f5',
        color: '#666',
        fontSize: '14px'
    },
    input: {
        flex: 1,
        padding: '12px',
        border: 'none',
        fontSize: '14px',
        outline: 'none'
    },
    inputFull: {
        width: '100%',
        padding: '12px',
        border: '1px solid #ddd',
        borderRadius: '8px',
        fontSize: '14px',
        boxSizing: 'border-box'
    },
    quickPrices: {
        display: 'flex',
        gap: '6px',
        marginTop: '8px'
    },
    quickPriceBtn: {
        flex: 1,
        padding: '6px',
        border: '1px solid #ddd',
        borderRadius: '6px',
        backgroundColor: '#fff',
        cursor: 'pointer',
        fontSize: '12px',
        color: '#333'
    },
    quickAmounts: {
        display: 'flex',
        gap: '6px',
        marginTop: '8px'
    },
    quickAmountBtn: {
        flex: 1,
        padding: '6px',
        border: '1px solid #ddd',
        borderRadius: '6px',
        backgroundColor: '#fff',
        cursor: 'pointer',
        fontSize: '12px',
        color: '#333'
    },
    estimate: {
        margin: '12px 20px',
        padding: '12px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px'
    },
    estimateRow: {
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '13px',
        color: '#666',
        marginBottom: '4px'
    },
    estimateValue: {
        fontWeight: '600',
        color: '#333'
    },
    actions: {
        display: 'flex',
        gap: '12px',
        padding: '16px 20px',
        borderTop: '1px solid #eee'
    },
    cancelBtn: {
        flex: 1,
        padding: '14px',
        border: '1px solid #ddd',
        borderRadius: '8px',
        backgroundColor: '#fff',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: '500',
        color: '#333'
    },
    submitBtn: {
        flex: 2,
        padding: '14px',
        border: 'none',
        borderRadius: '8px',
        color: '#fff',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: '600'
    }
};

export default TradeModal;
