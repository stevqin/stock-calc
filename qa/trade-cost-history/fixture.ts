export const isTauri = () => false;
export async function invoke() {
  throw new Error("验收页面不调用桌面接口");
}
