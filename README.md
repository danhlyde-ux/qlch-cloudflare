# Quản Lý Cửa Hàng — Cloudflare

## Thành phần
- `public/index.html`: giao diện quản lý hiện tại, đã thay lớp lưu trữ cũ bằng API Cloudflare.
- `worker.js`: API lưu/đọc tài liệu và phân phối giao diện.
- `schema.sql`: bảng D1 lưu dữ liệu.
- Dữ liệu được đồng bộ giữa các thiết bị bằng cách kiểm tra thay đổi mỗi 2 giây (gần thời gian thực).

## 1. Tạo D1
```bash
npx wrangler d1 create qlch-database
```
Lấy `database_id` trong kết quả và thay `REPLACE_WITH_D1_DATABASE_ID` trong `wrangler.json`.

## 2. Tạo bảng
```bash
npx wrangler d1 execute qlch-database --remote --file=./schema.sql
```

## 3. Bật Cloudflare Access — BẮT BUỘC
API chứa dữ liệu cửa hàng và thông tin tài khoản nội bộ. Không triển khai công khai nếu chưa bật Access.
1. Cloudflare Zero Trust → Access → Applications → Add an application → Self-hosted.
2. Chọn hostname sẽ dùng cho cửa hàng (ví dụ `qlch.tenmien.com`) và tạo policy chỉ cho email/tài khoản được phép.
3. Lưu Application AUD Tag.
4. Trong `wrangler.json`, điền:
   - `ACCESS_TEAM_DOMAIN`: ví dụ `congty.cloudflareaccess.com` (không có `https://`).
   - `ACCESS_AUD`: AUD Tag của Access Application.
5. Bảo đảm Access bảo vệ toàn bộ hostname, bao gồm `/api/*`. Worker cũng tự xác minh chữ ký JWT Cloudflare Access trước khi đọc/ghi D1.

## 4. Cài và triển khai
Cần Node.js và tài khoản Cloudflare đã đăng nhập:
```bash
npm install -g wrangler
npx wrangler login
npx wrangler deploy
```
Sau đó gắn domain trong Workers & Pages → qlch-cloudflare → Settings → Domains & Routes.

## 5. Dùng lần đầu và chuyển dữ liệu
- Mở website qua hostname đã bảo vệ bởi Cloudflare Access.
- Đăng nhập ứng dụng bằng tài khoản cửa hàng hiện có trên trình duyệt cũ.
- Nếu D1 chưa có dữ liệu, dữ liệu đang có trong trình duyệt sẽ được đẩy lên Cloudflare khi đã có thay đổi/lưu.
- Mở website trên thiết bị khác, đăng nhập Cloudflare Access rồi đăng nhập tài khoản cửa hàng.
- Giữ lại bản HTML cũ và xuất một file sao lưu JSON trước khi chuyển chính thức.

## Lưu ý quan trọng
- Đồng bộ dùng polling 2 giây, không phải WebSocket; thay đổi sẽ xuất hiện gần thời gian thực.
- Cơ chế đồng bộ hiện tại theo kiểu bản ghi mới nhất thắng. Tránh cùng lúc sửa cùng một mục từ hai thiết bị trong thời gian chuyển dữ liệu.
- Tài khoản/mật khẩu nội bộ của ứng dụng vẫn dùng cơ chế PBKDF2 hiện có; dữ liệu người dùng (chỉ gồm salt và hash mật khẩu) được lưu trong D1. Cloudflare Access là lớp bảo vệ bên ngoài bắt buộc.
- Nếu có dữ liệu local trên nhiều trình duyệt khác nhau, hãy hợp nhất/sao lưu trước khi cho các thiết bị cùng sử dụng chung dữ liệu.
