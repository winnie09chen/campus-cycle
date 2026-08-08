# 物候

课程结课项目：毕业季学生拍照上传闲置物品（教材、正装、水杯等），
系统自动识别分类、生成暖心文案，并匹配给有需求的低年级学生。

## 技术栈（对应课程四个技术点）

- **VLM 视觉语言（Qwen-VL）**：看图识别物品类别 + 生成暖心文案（DashScope API）
- **MediaPipe Hands**：检测上传图片中是否手部遮挡，提示重拍
- **NLP（Qwen）**：买家需求自然语言解析 + VLM 不可用时的文案兜底
- **Agent 匹配**：按规则打分，把物品推荐给有需求的低年级学生

## 运行方式

> 鉴权（登录/注册/用户审核）依赖 Netlify Functions，**必须用 `netlify dev` 运行**；`python -m http.server` 跑不了登录。

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
- **登录**：学号 + 密码。登录后按角色自动分流：学生→`index.html`，审核员→`reviewer.html`。两界面物理隔离、不互跳，各自有严格角色门禁。
- **审核员职责**：①认证学生身份 ②审核商品 ③处理举报 ④添加新审核员（工作台「添加审核员」按钮，新审核员密码同样邮件发送）。
- 用户表/验证码/会话存 Netlify Blobs（后端，per-key 存储）；密码用 `pbkdf2` 哈希；前端只存登录 token。

## 三角色页面

| 页面 | 角色 | 职责 |
|---|---|---|
| `login.html` | 公共入口 | 登录 / 学生注册，按角色分流 |
| `index.html` | 学生（买家/卖家/援助池） | 买家发布需求并匹配；卖家上传照片识别+文案、提交审核；困难生定向援助。学生界面，登录后可自由切换买卖 |
| `reviewer.html` | 审核员 | 认证学生、审核物品、处理举报、添加审核员 |

两个主界面共享 localStorage 物品数据，通过 `storage` 事件实时联动：
卖家提交 → 审核员队列实时刷新 → 审核通过 → 买家推荐列表实时更新。

## 文件分工

| 文件 | 负责人 | 说明 |
|---|---|---|
| `config.js` | 同学C | 全局配置（CDN/模型参数/类别标签/打分/角色/鉴权/密钥），唯一真相源 |
| `index.html` | 同学C | 学生界面：买卖/援助 + Agent 匹配 + 学生门禁 + owner 注入 |
| `reviewer.html` | 同学C | 审核员工作台：认证学生、审核物品、处理举报、添加审核员 + 审核员门禁 |
| `login.html` | 同学C | 公共登录/注册页，按角色分流到不同主界面 |
| `auth-module.js` | 同学C | 前端鉴权模块：登录/注册/会话/角色门禁 |
| `netlify/functions/auth.mjs` | 同学C | 鉴权后端：注册/登录/会话/用户审核/添加审核员（Blobs+nodemailer） |
| `vision-module.js` | 同学A | MediaPipe 手部遮挡检测 |
| `vlm-module.js` | 同学B | Qwen-VL 视觉语言模块：看图定类 + 出文案（DashScope API） |
| `nlp-module.js` | 同学B | 浏览器版 NLP：文案生成 + 需求解析（含离线兜底） |
| `prompt_engineering.py` | 同学B | Prompt 设计原稿（Python 版，Key 走环境变量） |

## 模块对接关系

```
卖家上传照片
  └─ window.detectItem(file)            [index.html 适配层，VLM 与 MediaPipe 并发]
       ├─ VLMModule.analyzeImage()      [同学B] → 精准类别 + 名称 + 暖心文案
       └─ VisionModule.analyzeImage()   [同学A] → MediaPipe 手部遮挡检测
  → 合并：类别/名称/描述取 VLM，遮挡提示取 MediaPipe
  → 降级：VLM 失败 → 演示数据；MediaPipe 失败 → 静默跳过不阻断
  └─ 提交审核 → 后台通过 → 上架
买家输入需求
  └─ window.parseDemand(text)           [同学B nlp-module] → 结构化需求
  └─ matchItems(demand)                 [同学C] → 打分排序
困难生援助需求
  └─ matchAidItems(need)                [同学C] → 从已审核物品中匹配 Top3
  └─ 锁定物品 → 普通推荐隐藏该物品 → 完成援助后物品下架并标记“已援助”
```

## 配置说明（config.js）

所有可调参数集中在 `config.js`（挂 `window.AppConfig`），各模块以 `AppConfig.xxx ?? 自带默认` 读取：
- `cdn`：MediaPipe / DashScope 端点
- `models`：vlm / nlp / mediaPipe 参数（模型名、超时、温度等）
- `categories`：标签映射、页面映射、默认科目（唯一来源，杜绝多处重复）
- `ui`：买家分页条数、图片压缩尺寸
- `scoring`：匹配打分权重（40/30/20/10/5）
- API Key 不在 `config.js`，统一存于 Netlify 环境变量 `DASHSCOPE_API_KEY`（本地放 `.env`）

## 匹配逻辑（同学C）

`matchItems(demand)` 对已通过审核的物品打分排序：类别匹配 +40、
科目匹配（双向包含）+30、价格在预算内 +20、笔记需求匹配 +10、零举报 +5。
`matchAidItems(need)` 面向困难生定向援助：类型匹配 +45、免费/公益 +30、
预算内 +20、紧急申请 +10、零举报 +5；支持“待匹配 → 已锁定 → 已完成”流转。
数据存于 localStorage（`campus_cycle_demo_v1`），含种子物品与需求。
