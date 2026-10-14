import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { InteractiveInvitation } from '../components/invitation/InteractiveInvitation';
import { CARD_H, CARD_W, InvitationCard } from '../components/invitation/InvitationCard';
import { ScaledFrame } from '../components/ui/ScaledFrame';
import { demoGuests } from '../data/demo';

/**
 * Trang dành cho người nhận thiệp — không có bất kỳ thành phần quản trị nào.
 * ?khach=<mã khách>  ·  ?che-do=tinh để xem thiệp tĩnh 9:16.
 */
export default function GuestInvitation() {
  const [params] = useSearchParams();
  const guest = demoGuests.find((g) => g.guest_id === params.get('khach'));
  const name = guest?.display_name ?? 'Quý Khách';
  const staticMode = params.get('che-do') === 'tinh';

  useEffect(() => {
    document.title = `Thiệp mời — ${name}`;
  }, [name]);

  if (!staticMode) return <InteractiveInvitation guestName={name} />;
  return <StaticView name={name} />;
}

function StaticView({ name }: { name: string }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const fit = () => {
      const pad = 32;
      setW(Math.min(window.innerWidth - pad, ((window.innerHeight - pad) * CARD_W) / CARD_H, CARD_W * 1.25));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return (
    <div className="velvet grid min-h-dvh place-items-center p-4">
      <div style={{ width: w }} className="shadow-[0_40px_80px_-30px_rgba(0,0,0,0.6)]">
        {w > 0 && (
          <ScaledFrame>
            <InvitationCard guestName={name} />
          </ScaledFrame>
        )}
      </div>
    </div>
  );
}
