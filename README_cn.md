# IV Surface 3D

一个用于查看美股和 ETF 期权隐含波动率曲面的 3D 网页工具。

你可以选择 ticker 和历史快照日期，应用会从 Alpha Vantage 拉取完整期权链，把 Call IV、Put IV 或 Average IV 渲染成可旋转、可缩放、可悬停查看细节的 3D 曲面。右侧还有标准化后的期权链切片，方便对照具体合约。

英文文档在 [README.md](README.md)。

## 当前状态

- 本地应用由 Express 后端和原生 Three.js 前端组成。
- 后端从 `config.yaml` 读取 `alphavantage.api_key`，浏览器不会拿到 API key。
- `/api/options` 代理 Alpha Vantage 的 `HISTORICAL_OPTIONS` 接口。
- ticker 下拉框使用 `src/stockPool.js` 里的默认股票池。
- 选中 ticker 或修改快照日期后，页面会自动加载数据，不需要再点 Load。
- 曲面口径可以在 `Average IV`、`Call IV`、`Put IV` 之间切换。
- 当前默认股票池已经全部缓存完成：102 个 symbol，共 198,702 条期权合约。

## 快速运行

安装依赖：

```bash
npm install
```

预取默认股票池：

```bash
npm run prefetch
```

启动本地服务：

```bash
npm start
```

打开：

```text
http://localhost:5173
```

如果只想拉几个指定 ticker，可以这样传参：

```bash
npm run prefetch -- AAPL NVDA QQQ
```

## 配置

创建或更新 `config.yaml`：

```yaml
alphavantage:
  api_key: "YOUR_ALPHA_VANTAGE_API_KEY"
```

也可以用环境变量 `ALPHAVANTAGE_API_KEY`。

## 默认股票池

默认股票池在 `src/stockPool.js`。它使用这次项目里给定的 NASDAQ 100 风格股票列表，并额外包含 `QQQ`。当前列表实际有 102 个唯一 ticker。

前端的 `Ticker` 下拉框从这个文件生成选项。`npm run prefetch` 没有传入 ticker 时，也会用同一个股票池批量拉取数据。

## 数据来源

数据来自 Alpha Vantage Options Data API：

```text
https://www.alphavantage.co/query?function=HISTORICAL_OPTIONS&symbol={ticker}&date={as_of_date}&apikey={ALPHAVANTAGE_API_KEY}
```

`date` 可以不传。不传时，Alpha Vantage 返回最新可用的历史期权链；传入时，页面会把这个日期当作历史快照日期，也用它来计算 DTE。

## 数据流程

1. 浏览器把 `symbol`、可选的 `date` 和 fallback 参数发给 `/api/options`。
2. Express 后端标准化 ticker 和日期。
3. 后端先查 `.cache/alphavantage`。
4. 如果没有可用缓存，后端再请求 Alpha Vantage。
5. 前端按 `expiration + strike` 聚合合约，合并 Call 和 Put，计算 DTE 和 Average IV，然后渲染 3D 曲面。

## 核心字段

| 字段 | 含义 | 示例 | 用途 |
| --- | --- | --- | --- |
| Ticker | 标的代码 | `NVDA`, `AAPL`, `QQQ` | API 请求和图表标题 |
| Snapshot Date | 历史快照日期 | `2026-05-01` | Alpha Vantage `date` 参数，也是 DTE 基准 |
| Expiration | 期权到期日 | `2026-05-08` | DTE 轴 |
| DTE | 距到期天数 | `4`, `11`, `18` | 期限结构 |
| Strike | 行权价 | `50` 到 `350` | Strike 轴 |
| Call IV | 看涨期权隐含波动率 | `0.35` | Call 曲面 |
| Put IV | 看跌期权隐含波动率 | `0.41` | Put 曲面 |
| Average IV | Call 和 Put 的平均 IV | `0.38` | 默认曲面 |
| Open Interest | 持仓量 | `1200` | hover 明细 |

## 界面

顶部控制区包含：

- `Ticker`：从默认股票池选择 ticker，选中后自动加载。
- `Snapshot`：选择历史快照日期，日期变化后自动加载。
- `Surface`：切换 Average、Call、Put 三种 IV 口径，不需要重新请求接口。
- `Reset View`：旋转或缩放 3D 图之后，把相机恢复到默认视角。

主工作区包含：

- Three.js 3D IV 曲面。
- 到期日数量、IV 点数、平均 IV、IV 区间、行权价区间这些统计指标。
- 可排序的期权链表格。
- hover tooltip，展示到期日、DTE、行权价、IV 和持仓量。

## 脚本

```bash
npm start
```

启动 Express 服务，默认地址是 `http://localhost:5173`。

```bash
npm run prefetch
```

拉取并缓存完整默认股票池。

```bash
npm run prefetch -- AAPL NVDA
```

只拉取并缓存指定 ticker。

```bash
npm run check
```

读取缓存数据并输出简短摘要。不传 ticker 时，使用脚本里的默认检查对象。

## 缓存目录

Alpha Vantage 返回内容会缓存到：

```text
.cache/alphavantage/
```

比如：

```text
NVDA_latest.json
AAPL_2026-05-01.json
QQQ_latest.json
```

后端会忽略空缓存。`latest` 缓存超过 24 小时后，后端会尝试刷新。

## 备注

- 这个项目用的是历史期权链，不是实时期权报价。
- DTE 按 `expiration - snapshot_date` 计算，不按运行程序当天日期计算。
- 渲染曲面前，前端会过滤掉很短 DTE 和无效 IV 数据。
- `src/app.js` 里给少数 ticker 配了单独的视图窗口，其他 ticker 使用通用的 strike 和 DTE 范围。
