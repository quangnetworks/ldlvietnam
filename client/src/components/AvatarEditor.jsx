import { useEffect, useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useApp, useToast } from '../context.jsx';
import { Avatar, Modal } from './ui.jsx';

const OUT = 512;

/** Cắt ảnh thành hình vuông ở giữa, thu nhỏ về 512px (giảm dung lượng, không lưu ảnh gốc). */
function squareCrop(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const size = Math.min(OUT, side);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Không xử lý được ảnh'))), 'image/jpeg', 0.9);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Tệp không phải ảnh hợp lệ')); };
    img.src = url;
  });
}

/** Ảnh đại diện có nút đổi / xoá (cho chính chủ hoặc quản trị viên). */
export default function AvatarEditor({ userId, name, color, size = 100, onChanged }) {
  const { user, avatarIndex, refreshMe, loadDirectory } = useApp();
  const toast = useToast();
  const input = useRef(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const canEdit = userId === user.id || user.role === 'admin';
  const hasPhoto = !!avatarIndex?.byId.get(userId);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const done = async (msg) => {
    toast(msg);
    if (userId === user.id) await refreshMe(); else await loadDirectory();
    onChanged?.();
  };
  const pick = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Vui lòng chọn tệp ảnh (JPG, PNG, WEBP...)', 'error'); return; }
    try {
      const blob = await squareCrop(file);
      setPreview({ blob, url: URL.createObjectURL(blob) });
    } catch (err) { toast(err.message, 'error'); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('files', new File([preview.blob], 'avatar.jpg', { type: 'image/jpeg' }));
      await api.post(`/account/users/${userId}/avatar`, fd);
      setPreview(null);
      await done('Đã cập nhật ảnh đại diện');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm('Xoá ảnh đại diện? Hệ thống sẽ hiển thị chữ viết tắt thay thế.')) return;
    try { await api.del(`/account/users/${userId}/avatar`); await done('Đã xoá ảnh đại diện'); } catch (err) { toast(err.message, 'error'); }
  };

  return (
    <div className="avatar-editor" style={{ width: size }}>
      <div className="avatar-editor-img">
        <Avatar uid={userId} name={name} color={color} size={size} />
        {canEdit && (
          <button type="button" className="avatar-editor-btn" title="Đổi ảnh đại diện" onClick={() => input.current.click()}>
            <Camera size={Math.max(14, size / 6)} />
          </button>
        )}
      </div>
      {canEdit && hasPhoto && size >= 64 && (
        <button type="button" className="link-btn small avatar-editor-del" onClick={remove}><Trash2 size={12} /> Xoá ảnh</button>
      )}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={pick} />
      {preview && (
        <Modal title="Ảnh đại diện mới" width={420} onClose={() => setPreview(null)}
          footer={<>
            <button className="btn" onClick={() => input.current.click()}>Chọn ảnh khác</button>
            <button className="btn btn-success" disabled={busy} onClick={save}>{busy ? 'Đang lưu...' : 'Lưu ảnh'}</button>
          </>}>
          <div className="avatar-preview">
            <Avatar src={preview.url} name={name} size={160} />
            <div className="row gap-sm"><Avatar src={preview.url} name={name} size={48} /><Avatar src={preview.url} name={name} size={30} /><Avatar src={preview.url} name={name} size={22} /></div>
            <small className="muted">Ảnh được cắt vuông ở giữa và thu nhỏ tự động.</small>
          </div>
        </Modal>
      )}
    </div>
  );
}
