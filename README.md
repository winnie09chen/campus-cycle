# 物候

课程结课项目：毕业季学生拍照上传闲置物品（教材、正装、水杯等），
系统自动识别分类、生成暖心文案，并匹配给有需求的低年级学生。

## 技术栈（对应课程四个技术点）

- **VLM 视觉语言（Qwen-VL）**：看图识别物品类别 + 生成暖心文案（DashScope API）
- **MediaPipe Hands**：检测上传图片中是否手部遮挡，提示重拍
- **NLP（Qwen）**：买家需求自然语言解析 + VLM 不可用时的文案兜底
- **Agent 匹配**：按规则打分，把物品推荐给有需求的低年级学生

## 运行方式

> 鉴权与业务接口（登录/注册/用户审核/共享数据/AI/图片）依赖 Netlify Functions，**必须用 `netlify dev` 运行**；`python -m http.server` 跑不了登录与鉴权接口。

1. **配置环境变量**：复制 `.env.example` 为 `.env`，填入：
   - `DASHSCOPE_API_KEY`：阿里云百炼 Key（VLM/NLP）
   - `MAIL_*`：QQ 或 163 邮箱 SMTP（用于注册验证码与随机密码发送，需在邮箱设置里开启 SMTP 并取得授权码）
2. **安装依赖并启动**：
   ```bash
   npm install -g netlify-cli
   npm install                 # 安装 @netlify/blobs、nodemailer
   netlify dev                 # 起 静态站 + Functions + Blobs，自动从 .env 注入环境变量
   ```
   访问 `netlify dev` 分配的端口下的 `/login.html` 进入登录页。
   > 仅预览静态 UI（Functions/Blobs 不可用）时可用 `python -m http.server 8000`，但登录/AI 识别/远程数据/图片存储均不可用。
3. **演示账号**：学生 `student` / `student123`；审核员 `admin` / `admin123`（首次调用鉴权接口时由后端 `ensureSeed()` 自动创建）。

## 账号与登录

- **注册（仅学生）**：邮箱 + 学号 + 邮箱验证码；密码由系统随机生成并通过邮件发送，无需自己设置。注册后状态为「待认证」，需审核员认证后才能发布。
- **登录**：学号 + 密码。登录后按角色自动分流：学生→`index.html`，审核员→`reviewer.html`。两界面物理隔离、不互跳，各自有严格角色门禁。连续输错密码 5 次锁定 10 分钟（防暴力破解）。
- **审核员职责**：①认证学生身份 ②审核商品 ③处理举报 ④添加新审核员（工作台「添加审核员」按钮，新审核员密码同样邮件发送）。
- 用户表/验证码/会话存 Netlify Blobs（后端，per-key 存储）；密码用 `pbkdf2` 哈希；前端只存登录 token。

## 接口安全

- **后端接口全部鉴权**：`data` / `ai` / `image(POST)` 均要求 `Authorization: Bearer <token>`（复用登录会话，`netlify/functions/_shared/auth-guard.mjs` 统一校验），未登录返回 401，防止数据被篡改、DashScope 配额被盗刷、图片存储被滥用；`image(GET)` 因 `<img>` 标签无法带请求头而保持开放，图片 id 为不可猜测的 UUID（能力 URL 模式）。
- **图片上传限制**：base64 解码后约 2MB 上限，超出返回 413。
- **验证码**：`crypto.randomInt` 密码学安全随机，5 分钟有效、60 秒冷却。
- **登录防爆破**：失败计数存独立 Blobs store，5 次失败锁 10 分钟，登录成功自动清零；改密码的旧密码校验同样计数。

## 三角色页面

| 页面 | 角色 | 职责 |
|---|---|---|
| `login.html` | 公共入口 | 登录 / 学生注册，按角色分流 |
| `index.html` | 学生（买家/卖家/援助池/我的交易） | 买家发布需求并匹配；卖家上传照片识别+文案、提交审核；困难生定向援助；模拟钱包与托管交易 |
| `reviewer.html` | 审核员 | 认证学生、审核物品、处理举报、添加审核员、交易总览 |
| `profile.html` | 所有登录用户 | 个人中心：查看个人信息、修改昵称/密码、退出 |

两个主界面共享 localStorage 物品数据，通过 `storage` 事件实时联动：
卖家提交 → 审核员队列实时刷新 → 审核通过 → 买家推荐列表实时更新。

**个人中心入口**：登录后点击顶栏头像/昵称进入 `profile.html`，可改昵称（头像首字母同步）、改密码、退出。

## 交易功能（模拟钱包）

站内模拟钱包 + 托管交易（**非真实支付**，余额为模拟值，存共享数据层）：

- **钱包**：每个用户有余额（初始 ¥1000），「我的交易」tab 内可「充值 / 提现」（模拟改余额）
- **托管交易流程**：
  - 买家在物品卡点「购买」→ 校验余额 → **扣款冻结**（买家 −价），订单 `待卖家确认`，物品置为「已预订」
  - 卖家「接受 / 拒绝」：拒绝 → 退款买家；接受 → 进入「待完成」
  - 任一方点「完成交易」→ **卖家到账**（卖家 +价），物品「已售」并下架
  - 完成前可「取消」→ 退款买家，物品重新可买
- **护栏**：余额不足提示充值、不能买自己的物品、已售/已预订物品不再被推荐（`matchItems` 过滤）
- **审核员「交易总览」**：订单总数 / 进行中 / 已完成 / 成交总额 + 全部订单列表（只读监察）
- 卖家信息展示在物品卡（`👤 卖家名`）和详情弹窗；买家匹配自动排除自己的物品
- 数据：`data.orders`（订单）、`data.balances`（按学号的余额表）、物品 `txStatus`/`lockedOrderId`

## 模块对接关系

```
卖家上传照片
  └─ window.detectItem(file)            [index.html 适配层，VLM 与 MediaPipe 并发]
       ├─ VLMModule.analyzeImage()      → 精准类别 + 名称 + 暖心文案
       └─ VisionModule.analyzeImage()   → MediaPipe 手部遮挡检测
   → 合并：类别/名称/描述取 VLM，遮挡提示取 MediaPipe
   → 降级：VLM 失败 → 演示数据；MediaPipe 失败 → 静默跳过不阻断
   └─ 提交审核 → 后台通过 → 上架
买家输入需求
  └─ window.parseDemand(text)           [nlp-module] → 结构化需求
  └─ matchItems(demand)                 → 打分排序
困难生援助需求
  └─ matchAidItems(need)                → 从已审核物品中匹配 Top3
  └─ 锁定物品 → 普通推荐隐藏该物品 → 完成援助后物品下架并标记“已援助”
```

## 配置说明（config.js）

所有可调参数集中在 `config.js`（挂 `window.AppConfig`），各模块以 `AppConfig.xxx ?? 自带默认` 读取：
- `cdn`：MediaPipe / DashScope 端点
- `models`：vlm / nlp / mediaPipe 参数（模型名、超时、温度等）
- `categories`：标签映射、页面映射、默认科目（唯一来源，杜绝多处重复）
- `storageKeys`：localStorage 键（业务数据 `campus_cycle_demo_v1`、登录会话 `campus_cycle_session_v1`）
- `roles`：角色常量（student / reviewer）
- `auth`：鉴权端点与各角色页面（loginPage / studentPage / reviewerPage / profilePage）
- `ui`：买家分页条数、图片压缩尺寸
- `scoring`：匹配打分权重（40/30/20/10/5）
- `transaction`：交易参数（`startBalance` 初始余额）
- API Key 不在 `config.js`，统一存于 Netlify 环境变量 `DASHSCOPE_API_KEY` 与 `MAIL_*`（本地放 `.env`）

## 匹配逻辑

`matchItems(demand)` 对已通过审核的物品打分排序：类别匹配 +40、
科目匹配（双向包含）+30、价格在预算内 +20、笔记需求匹配 +10、零举报 +5。
`matchAidItems(need)` 面向困难生定向援助：类型匹配 +45、免费/公益 +30、
预算内 +20、紧急申请 +10、零举报 +5；支持“待匹配 → 已锁定 → 已完成”流转。
数据存于 localStorage（`campus_cycle_demo_v1`），含种子物品与需求。
