const ORDER_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ORDER_ID_LENGTH = 6;
export const ORDER_ID_PATTERN = /^[A-Z2-9]{6}$/;

export function generateOrderId(): string {
  let out = '';
  for (let i = 0; i < ORDER_ID_LENGTH; i += 1) {
    out += ORDER_ID_CHARS[Math.floor(Math.random() * ORDER_ID_CHARS.length)];
  }
  return out;
}
