// ===== 鉴权后端：注册 / 登录 / 会话 / 用户审核 / 添加审核员 =====
// 用户表、验证码、会话均存 Netlify Blobs（per-key 存储，避开整文档覆盖竞态）。
// 密码用 pbkdf2 哈希；验证码与随机密码通过 nodemailer (QQ/163 SMTP) 发送。
// 前端统一 POST /.netlify/functions/auth，body 带 { action, ... }。
import { getStore } from "@netlify/blobs";
import nodemailer from "nodemailer";
import crypto from "node:crypto";

const USERS_STORE = getStore({ name: "campus-cycle-users", consistency: "strong" });
const CODES_STORE = getStore({ name: "campus-cycle-codes", consistency: "strong" });
const SESSIONS_STORE = getStore({ name: "campus-cycle-sessions", consistency: "strong" });

const MAIL_HOST = process.env.MAIL_HOST;
const MAIL_PORT = Number(process.env.MAIL_PORT) || 465;
const MAIL_USER = process.env.MAIL_USER;
const MAIL_PASS = process.env.MAIL_PASS;
const MAIL_FROM = process.env.MAIL_FROM || MAIL_USER;

const CODE_TTL_MS = 5 * 60 * 1000;      // 验证码 5 分钟有效
const CODE_COOLDOWN_MS = 60 * 1000;     // 同一邮箱 60 秒内不能重发
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 会话 7 天

// ---------- 工具 ----------
function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {})
    }
  });
}

function genSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
}

function genRandomPassword(len = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(len);
  let p = "";
  for (let i = 0; i < len; i++) p += chars[bytes[i] % chars.length];
  return p;
}

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function genToken() {
  return crypto.randomUUID() + crypto.randomBytes(8).toString("hex");
}

const AVATAR_PALETTE = ["#c8192e", "#168a52", "#2563eb", "#b45309", "#7c3aed", "#0891b2"];
function genAvatar(nickname) {
  const letter = (nickname || "?").trim().charAt(0).toUpperCase() || "?";
  const color = AVATAR_PALETTE[(nickname || "?").charCodeAt(0) % AVATAR_PALETTE.length];
  return { letter, color };
}

function publicUser(user) {
  if (!user) return null;
  return {
    studentId: user.studentId,
    email: user.email,
    nickname: user.nickname,
    avatar: user.avatar,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt
  };
}

// ---------- 邮件 ----------
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: MAIL_HOST,
    port: MAIL_PORT,
    secure: MAIL_PORT === 465,
    auth: { user: MAIL_USER, pass: MAIL_PASS }
  });
  return transporter;
}

async function sendMail(to, subject, html) {
  if (!MAIL_HOST || !MAIL_USER || !MAIL_PASS) {
    throw new Error("邮件服务未配置（请设置 MAIL_HOST / MAIL_USER / MAIL_PASS）");
  }
  await getTransporter().sendMail({ from: MAIL_FROM, to, subject, html });
}

function mailHtml(title, lines, footnote) {
  const items = lines.map((t) => `<p style="margin:8px 0;font-size:15px;color:#20242a;">${t}</p>`).join("");
  const foot = footnote ? `<p style="margin-top:16px;font-size:13px;color:#68707d;">${footnote}</p>` : "";
  return `
  <div style="max-width:480px;margin:0 auto;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;">
    <div style="background:#c8192e;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;">
      <div style="font-size:18px;font-weight:700;">物候 · Campus Cycle</div>
      <div style="font-size:13px;opacity:.9;">万物有时，静候良人</div>
    </div>
    <div style="border:1px solid #e6e8ec;border-top:none;padding:20px;border-radius:0 0 10px 10px;">
      <div style="font-size:16px;font-weight:700;color:#c8192e;margin-bottom:8px;">${title}</div>
      ${items}
      ${foot}
    </div>
  </div>`;
}

// ---------- 预置账号（冷启动时确保存在） ----------
let seedPromise = null;
async function ensureSeed() {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    if (!(await USERS_STORE.get("user:admin", { type: "json" }))) {
      const salt = genSalt();
      await USERS_STORE.setJSON("user:admin", {
        studentId: "admin",
        email: "",
        passwordHash: hashPassword("admin123", salt),
        salt,
        nickname: "管理员",
        avatar: genAvatar("管理员"),
        role: "reviewer",
        status: "verified",
        createdAt: new Date().toISOString()
      });
    }
    if (!(await USERS_STORE.get("user:student", { type: "json" }))) {
      const salt = genSalt();
      await USERS_STORE.setJSON("user:student", {
        studentId: "student",
        email: "",
        passwordHash: hashPassword("student123", salt),
        salt,
        nickname: "演示学生",
        avatar: genAvatar("演示学生"),
        role: "student",
        status: "verified",
        createdAt: new Date().toISOString()
      });
    }
  })();
  return seedPromise;
}

// ---------- 会话 ----------
async function createSession(studentId) {
  const token = genToken();
  await SESSIONS_STORE.setJSON(`session:${token}`, {
    studentId,
    createdAt: Date.now(),
    exp: Date.now() + SESSION_TTL_MS
  });
  return token;
}

async function getSessionUser(token) {
  if (!token) return null;
  const session = await SESSIONS_STORE.get(`session:${token}`, { type: "json" });
  if (!session) return null;
  if (Date.now() > session.exp) return null;
  const user = await USERS_STORE.get(`user:${session.studentId}`, { type: "json" });
  return user || null;
}

// ---------- 邮箱查重（遍历用户，演示规模足够） ----------
async function emailExists(email) {
  const { blobs } = await USERS_STORE.list();
  for (const b of blobs) {
    const u = await USERS_STORE.get(b.key, { type: "json" });
    if (u && u.email && u.email.toLowerCase() === email.toLowerCase()) return true;
  }
  return false;
}

// ---------- 各 action ----------
async function sendCode(payload) {
  const email = String(payload.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "邮箱格式不正确" }, { status: 400 });

  const existing = await CODES_STORE.get(`code:${email}`, { type: "json" });
  const now = Date.now();
  if (existing && now - existing.lastSent < CODE_COOLDOWN_MS) {
    const wait = Math.ceil((CODE_COOLDOWN_MS - (now - existing.lastSent)) / 1000);
    return json({ error: `请 ${wait} 秒后再试` }, { status: 429 });
  }

  const code = genCode();
  await CODES_STORE.setJSON(`code:${email}`, { code, lastSent: now, exp: now + CODE_TTL_MS });

  try {
    await sendMail(
      email,
      "【物候】你的注册验证码",
      mailHtml(
        "注册验证码",
        [`你的验证码是：<b style="font-size:22px;letter-spacing:4px;color:#c8192e;">${code}</b>`, "验证码 5 分钟内有效，请尽快完成注册。"],
        "如果这不是你本人的操作，请忽略此邮件。"
      )
    );
  } catch (e) {
    return json({ error: "验证码发送失败：" + e.message }, { status: 502 });
  }
  return json({ ok: true, message: "验证码已发送，请查收邮箱" });
}

async function register(payload) {
  const studentId = String(payload.studentId || "").trim();
  const email = String(payload.email || "").trim().toLowerCase();
  const code = String(payload.code || "").trim();
  if (!studentId) return json({ error: "请填写学号" }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "邮箱格式不正确" }, { status: 400 });
  if (!/^\d{4,}$/.test(code)) return json({ error: "请填写验证码" }, { status: 400 });

  const record = await CODES_STORE.get(`code:${email}`, { type: "json" });
  if (!record) return json({ error: "请先获取验证码" }, { status: 400 });
  if (Date.now() > record.exp) return json({ error: "验证码已过期，请重新获取" }, { status: 400 });
  if (record.code !== code) return json({ error: "验证码不正确" }, { status: 400 });

  if (await USERS_STORE.get(`user:${studentId}`, { type: "json" })) {
    return json({ error: "该学号已注册" }, { status: 400 });
  }
  if (await emailExists(email)) {
    return json({ error: "该邮箱已被使用" }, { status: 400 });
  }

  const password = genRandomPassword();
  const salt = genSalt();
  const user = {
    studentId,
    email,
    passwordHash: hashPassword(password, salt),
    salt,
    nickname: studentId,
    avatar: genAvatar(studentId),
    role: "student",
    status: "pending",
    createdAt: new Date().toISOString()
  };
  await USERS_STORE.setJSON(`user:${studentId}`, user);
  await CODES_STORE.delete(`code:${email}`);

  try {
    await sendMail(
      email,
      "【物候】你的账号密码",
      mailHtml(
        "注册成功",
        [`学号：<b>${studentId}</b>`, `登录密码：<b style="font-size:18px;color:#c8192e;">${password}</b>`, "请用此密码登录。登录后可到「个人中心」修改。"],
        "管理员审核你的学生身份后即可发布商品。请妥善保管密码。"
      )
    );
  } catch (e) {
    return json({ error: "账号已创建，但密码邮件发送失败：" + e.message }, { status: 502 });
  }
  return json({ ok: true, message: "注册成功，密码已发送到你的邮箱" });
}

async function login(payload) {
  const studentId = String(payload.studentId || "").trim();
  const password = String(payload.password || "");
  if (!studentId || !password) return json({ error: "请输入学号和密码" }, { status: 400 });

  const user = await USERS_STORE.get(`user:${studentId}`, { type: "json" });
  if (!user) return json({ error: "学号或密码错误" }, { status: 400 });
  if (user.status === "rejected") return json({ error: "该账号已被禁用" }, { status: 403 });
  if (hashPassword(password, user.salt) !== user.passwordHash) {
    return json({ error: "学号或密码错误" }, { status: 400 });
  }

  const token = await createSession(studentId);
  return json({ ok: true, token, user: publicUser(user) });
}

async function me(payload) {
  const user = await getSessionUser(payload.token);
  if (!user) return json({ error: "未登录或会话已过期" }, { status: 401 });
  return json({ ok: true, user: publicUser(user) });
}

async function listUsers(payload) {
  const caller = await getSessionUser(payload.token);
  if (!caller || caller.role !== "reviewer") return json({ error: "无权限" }, { status: 403 });
  const { blobs } = await USERS_STORE.list();
  const users = [];
  for (const b of blobs) {
    const u = await USERS_STORE.get(b.key, { type: "json" });
    if (u && (!payload.status || u.status === payload.status)) users.push(publicUser(u));
  }
  users.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  return json({ ok: true, users });
}

async function verifyUser(payload) {
  const caller = await getSessionUser(payload.token);
  if (!caller || caller.role !== "reviewer") return json({ error: "无权限" }, { status: 403 });
  const user = await USERS_STORE.get(`user:${payload.studentId}`, { type: "json" });
  if (!user) return json({ error: "用户不存在" }, { status: 404 });
  const ok = payload.action === "reject" ? "rejected" : "verified";
  user.status = ok;
  await USERS_STORE.setJSON(`user:${payload.studentId}`, user);
  return json({ ok: true, user: publicUser(user) });
}

async function addReviewer(payload) {
  const caller = await getSessionUser(payload.token);
  if (!caller || caller.role !== "reviewer") return json({ error: "无权限" }, { status: 403 });
  const studentId = String(payload.studentId || "").trim();
  const email = String(payload.email || "").trim().toLowerCase();
  if (!studentId) return json({ error: "请填写学号" }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "邮箱格式不正确" }, { status: 400 });
  if (await USERS_STORE.get(`user:${studentId}`, { type: "json" })) {
    return json({ error: "该学号已存在" }, { status: 400 });
  }

  const password = genRandomPassword();
  const salt = genSalt();
  const nickname = payload.nickname ? String(payload.nickname).trim() : `审核员-${studentId}`;
  await USERS_STORE.setJSON(`user:${studentId}`, {
    studentId,
    email,
    passwordHash: hashPassword(password, salt),
    salt,
    nickname,
    avatar: genAvatar(nickname),
    role: "reviewer",
    status: "verified",
    createdAt: new Date().toISOString()
  });

  try {
    await sendMail(
      email,
      "【物候】审核员账号已创建",
      mailHtml(
        "你已被添加为审核员",
        [`学号：<b>${studentId}</b>`, `登录密码：<b style="font-size:18px;color:#c8192e;">${password}</b>`, "请用此密码登录审核员工作台。"],
        "请妥善保管密码，登录后可自行修改。"
      )
    );
  } catch (e) {
    return json({ error: "审核员已创建，但密码邮件发送失败：" + e.message }, { status: 502 });
  }
  return json({ ok: true, message: "审核员已创建，密码已发送到其邮箱" });
}

const ACTIONS = {
  sendCode, register, login, me, listUsers, verifyUser, addReviewer
};

export default async function handler(request) {
  await ensureSeed();
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || !ACTIONS[payload.action]) {
    return json({ error: "Invalid action" }, { status: 400 });
  }
  try {
    return await ACTIONS[payload.action](payload);
  } catch (error) {
    return json({ error: "Server error: " + error.message }, { status: 500 });
  }
}
