import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { App } from 'antd';
import { useBeforeUnload, useBlocker } from 'react-router-dom';
import { registerGuardedExit } from '@/features/navigation/guardedExit';

/**
 * 同时拦截 Data Router 内导航和浏览器刷新/关闭。
 * 技能与数据连接授权不应传入 dirty；它们走独立接口并即时生效。
 */
export type AgentEditorBusyState = 'saving' | 'publishing' | null;

export default function useUnsavedChangesGuard(
  dirty: boolean,
  busy: AgentEditorBusyState = null,
) {
  const { modal } = App.useApp();
  const shouldBlock = dirty || busy !== null;
  const bypassNextExit = useRef(false);
  const blocker = useBlocker(() => shouldBlock && !bypassNextExit.current);
  const promptOpen = useRef(false);

  const openConfirmation = useCallback(
    ({
      context,
      onConfirm,
      onCancel,
    }: {
      context: 'navigation' | 'logout';
      onConfirm: () => void;
      onCancel: () => void;
    }) => {
      if (promptOpen.current) return;
      promptOpen.current = true;
      const action = busy === 'publishing' ? '发布' : busy === 'saving' ? '保存' : null;
      const loggingOut = context === 'logout';
      modal.confirm({
        title: action
          ? `Agent 正在${action}，确定${loggingOut ? '退出登录' : '离开'}？`
          : loggingOut
            ? '退出登录并放弃未保存的变更？'
            : '离开并放弃未保存的变更？',
        content: action
          ? dirty
            ? `Agent 正在${action}，且基础信息、Prompt、模型参数或知识库还有未保存内容。${loggingOut ? '退出' : '离开'}后新修改会丢失。`
            : `Agent 正在${action}。操作完成前${loggingOut ? '退出' : '离开'}可能错过结果与界面状态同步。`
          : '基础信息、Prompt、模型参数或知识库还有未保存内容。离开后这些更改会丢失。',
        okText: action
          ? loggingOut
            ? '仍要退出'
            : '仍要离开'
          : loggingOut
            ? '放弃并退出'
            : '放弃并离开',
        cancelText: action && loggingOut ? '继续等待' : '继续编辑',
        okButtonProps: { danger: true },
        onOk: () => {
          promptOpen.current = false;
          onConfirm();
        },
        onCancel: () => {
          promptOpen.current = false;
          onCancel();
        },
        afterClose: () => {
          promptOpen.current = false;
        },
      });
    },
    [busy, dirty, modal],
  );

  useLayoutEffect(() => {
    if (!shouldBlock) return;
    return registerGuardedExit({
      request: ({ proceed }) =>
        openConfirmation({
          context: 'logout',
          onConfirm: () => {
            bypassNextExit.current = true;
            proceed();
          },
          onCancel: () => undefined,
        }),
      bypass: () => {
        bypassNextExit.current = true;
      },
    });
  }, [openConfirmation, shouldBlock]);

  useBeforeUnload(
    useCallback(
      (event) => {
        if (!shouldBlock || bypassNextExit.current) return;
        event.preventDefault();
        event.returnValue = '';
      },
      [shouldBlock],
    ),
  );

  useEffect(() => {
    if (blocker.state !== 'blocked' || promptOpen.current) return;
    openConfirmation({
      context: 'navigation',
      onConfirm: blocker.proceed,
      onCancel: blocker.reset,
    });
  }, [blocker, openConfirmation]);
}
