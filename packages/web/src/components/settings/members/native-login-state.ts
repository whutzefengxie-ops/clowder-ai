export interface NativeLoginState {
  status: 'login_required' | 'configured' | 'unknown' | 'not_installed';
  checkedAt: number;
  loginCommand?: string;
}
