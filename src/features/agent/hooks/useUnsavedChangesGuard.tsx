import { useCallback, useEffect, useRef } from 'react';
import { App } from 'antd';
import { useBeforeUnload, useBlocker } from 'react-router-dom';

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
  const blocker = useBlocker(shouldBlock);
  const promptOpen = useRef(false);

  useBeforeUnload(
    useCallback(
      (event) => {
        if (!shouldBlock) return;
        event.preventDefault();
        event.returnValue = '';
      },
      [shouldBlock],
    ),
  );

  useEffect(() => {
    if (blocker.state !== 'blocked' || promptOpen.current) return;
    promptOpen.current = true;
    const action = busy === 'publishing' ? '发布' : busy === 'saving' ? '保存' : null;
    modal.confirm({
      title: action ? `Agent 正在${action}，确定离开？` : '离开并放弃未保存的变更？',
      content: action
        ? dirty
          ? `Agent 正在${action}，且基础信息、Prompt、模型参数或知识库还有未保存内容。离开后新修改会丢失。`
          : `Agent 正在${action}。操作完成前离开可能错过结果与界面状态同步。`
        : '基础信息、Prompt、模型参数或知识库还有未保存内容。离开后这些更改会丢失。',
      okText: action ? '仍要离开' : '放弃并离开',
      cancelText: '继续编辑',
      okButtonProps: { danger: true },
      onOk: () => {
        promptOpen.current = false;
        blocker.proceed();
      },
      onCancel: () => {
        promptOpen.current = false;
        blocker.reset();
      },
      afterClose: () => {
        promptOpen.current = false;
      },
    });
  }, [blocker, busy, dirty, modal]);
}
