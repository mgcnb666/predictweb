# Predict.fun Trading App

一个基于 [Predict.fun](https://predict.fun) 预测市场的交易应用，支持查看市场、连接钱包、交易和持仓管理功能。

## ✨ 功能特性

- 📊 **市场浏览** - 查看所有预测市场及其状态
- 📖 **订单簿** - 实时显示买卖订单深度
- 💹 **交易功能** - 支持限价单和市价单
- 📋 **订单管理** - 查看、取消挂单
- 💼 **持仓查看** - 显示当前持仓和盈亏

## 📁 项目结构

```
predict-fun-trading/
├── backend/                    # Express.js 后端代理服务
│   ├── server.js               # 主服务器文件
│   ├── package.json
│   └── .env                    # 环境变量配置（需创建）
├── frontend/                   # React + Vite 前端应用
│   ├── src/
│   │   ├── App.jsx             # 主应用组件
│   │   ├── App.css             # 全局样式
│   │   └── components/
│   │       ├── MarketList.jsx  # 市场列表组件
│   │       ├── TradeModal.jsx  # 交易弹窗组件（限价/市价单）
│   │       ├── WalletConnect.jsx # 钱包连接组件
│   │       ├── OrderBook.jsx   # 订单簿组件
│   │       ├── Orders.jsx      # 订单列表组件
│   │       └── Positions.jsx   # 持仓组件
│   └── package.json
└── README.md
```

## 🚀 快速开始

### 前置要求

- Node.js >= 18.0.0
  
- npm 或 yarn
- MetaMask 钱包
- Predict.fun API Key
# 安装 Node.js 20.x（LTS 版本）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 验证安装
node -v
npm -v
### 1. 获取 API Key

1. 访问 [Predict.fun](https://predict.fun)
2. 注册/登录账户
3. 在开发者设置中获取 API Key

### 2. 配置后端

```bash
# 进入后端目录
cd backend

# 安装依赖
npm install

# 创建环境变量文件
cp .env.example .env
```

编辑 `.env` 文件：

```env
# 服务器端口
PORT=3485

# API Base URL（主网）
API_BASE_URL=https://api.predict.fun

# 你的 API Key（必需）
PREDICT_API_KEY=your_api_key_here
```

### 3. 配置前端

```bash
# 进入前端目录
cd frontend

# 安装依赖
npm install
```

### 4. 启动应用

**方式一：分别启动**

```bash
# 终端 1 - 启动后端
cd backend
npm run dev

# 终端 2 - 启动前端
cd frontend
npm run dev
```

**方式二：同时启动（推荐）**

```bash
# macOS/Linux
cd backend && npm run dev &
cd frontend && npm run dev
```

### 5. 访问应用

- 前端：http://localhost:5173
- 后端 API：http://localhost:3485
- 健康检查：http://localhost:3485/api/health

## 📖 API 端点

后端提供以下代理端点：

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/health` | GET | 健康检查，验证 API Key 配置 |
| `/api/markets` | GET | 获取市场列表 |
| `/api/markets/:marketId` | GET | 获取市场详情 |
| `/api/orderbook/:marketId` | GET | 获取订单簿 |
| `/api/auth/message` | GET | 获取认证消息 |
| `/api/auth` | POST | 获取 JWT Token |
| `/api/account` | GET | 获取账户信息（需认证） |
| `/api/account/referral` | POST | 设置邀请码（需认证） |
| `/api/orders` | GET | 获取订单列表（需认证） |
| `/api/orders` | POST | 创建订单（需认证） |
| `/api/orders/remove` | POST | 取消订单（需认证） |
| `/api/positions` | GET | 获取持仓（需认证） |

## 🔧 功能说明

### ✅ 已实现功能
- ✅ 查看预测市场列表
- ✅ 市场分类和状态显示
- ✅ JWT 认证流程
- ✅ 订单簿实时显示
- ✅ 限价单创建与提交
- ✅ 市价单创建与提交
- ✅ 订单列表查看
- ✅ 订单取消功能
- ✅ 持仓查看
- ✅ 盈亏计算


## 📦 依赖说明

### 后端
- express - Web 框架
- axios - HTTP 客户端
- cors - 跨域支持
- compression - Gzip 压缩
- dotenv - 环境变量

### 前端
- react - UI 框架
- vite - 构建工具
- axios - HTTP 客户端
- ethers - 以太坊库
- @predictdotfun/sdk - Predict.fun 官方 SDK

## 📚 参考文档

- [Predict.fun API 文档](https://dev.predict.fun)

## 📄 许可证

MIT License
