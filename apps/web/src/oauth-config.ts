/**
 * GitHub OAuth 配置。
 * client_id 是公开标识（OAuth App 的前端标识，无保密要求），
 * 预置默认值便于开箱即用；用户可在设置页覆盖（localStorage 优先）。
 */
export const DEFAULT_GITHUB_CLIENT_ID = 'Ov23li2olBGr9xuZi6ip';

/** 设备流授权范围：读写仓库（与 GitHubAdapter 的 contents API 匹配） */
export const DEVICE_FLOW_SCOPE = 'repo';
