export type GuardedExitReason = 'logout';

interface GuardedExitRequest {
  reason: GuardedExitReason;
  proceed: () => void;
}

interface ActiveExitGuard {
  request: (request: GuardedExitRequest) => void;
  bypass: () => void;
}

let activeGuard: ActiveExitGuard | null = null;

/** 当前页面注册一个主动退出协议；cleanup 只移除自己，避免旧页面卸载覆盖新页面的 guard。 */
export function registerGuardedExit(guard: ActiveExitGuard) {
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = null;
  };
}

/** 用户主动退出时走确认；没有编辑保护的页面直接执行。 */
export function requestGuardedExit(request: GuardedExitRequest) {
  if (activeGuard) {
    activeGuard.request(request);
    return;
  }
  request.proceed();
}

/** 会话已被服务端判定失效时不可再让本地草稿阻挡，401/403 直接退出。 */
export function bypassGuardedExit() {
  activeGuard?.bypass();
}
