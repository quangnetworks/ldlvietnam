import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LockKeyhole } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Field';
import { Monogram } from '../ui/Monogram';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(pw);
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="velvet grid min-h-dvh place-items-center px-4 py-10">
      <form onSubmit={submit} className="paper animate-fade-up w-full max-w-sm rounded-[28px] border border-champagne/40 p-8 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.6)]">
        <Monogram className="mx-auto size-16 text-[64px]" tone="burgundy" />
        <p className="eyebrow mt-6 text-center text-champagne-deep">Wedding Studio</p>
        <h1 className="mt-1 text-center font-serif text-[30px] text-burgundy-800">Đăng nhập</h1>
        <p className="mt-2 text-center text-[13px] text-espresso-soft">Khu vực quản lý thiệp dành cho chủ tiệc.</p>
        <TextField
          className="mt-7"
          label="Mật khẩu"
          type="password"
          autoComplete="current-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
        />
        {error && <p className="mt-3 rounded-xl bg-rose-soft px-3.5 py-2.5 text-[13px] text-burgundy-700">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="mt-6 w-full" disabled={!pw || busy} icon={<LockKeyhole className="size-4" />}>
          {busy ? 'Đang kiểm tra…' : 'Vào Studio'}
        </Button>
        <Link to="/" className="mt-5 block text-center text-[12.5px] text-espresso-soft hover:text-burgundy-700">
          ← Về website cưới
        </Link>
      </form>
    </div>
  );
}
