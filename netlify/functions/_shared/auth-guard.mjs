// ===== 共享鉴权守卫（供 data / ai / image 等 Functions 复用） =====
// 从 Authorization: Bearer <token> 解析会话，校验有效期并返回用户。
// 注意：与 auth.mjs 一致，store 每次请求重建，避免暖实例持有过期令牌。
import { getStore } from "@netlify/blobs";

function sessionsStore() {
  return getStore({ name: "campus-cycle-sessions", consistency: "strong" });
}

// 返回 user（有效会话）或 null（无/过期/无效）
export async function getUser(request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;
  const session = await sessionsStore().get(`session:${token}`, { type: "json" });
  if (!session || Date.now() > session.exp) return null;
  const users = getStore({ name: "campus-cycle-users", consistency: "strong" });
  return (await users.get(`user:${session.studentId}`, { type: "json" })) || null;
}

// 组合用法：返回 [user, response?]，user 为 null 时 response 即 401 响应
export async function requireUser(request) {
  const user = await getUser(request);
  if (!user) {
    return [
      null,
      new Response(JSON.stringify({ error: "未登录或会话已过期" }), {
        status: 401,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        }
      })
    ];
  }
  return [user, null];
}
