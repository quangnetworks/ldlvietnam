import { useState } from 'react';
import { BookOpen, FileText, Workflow, Download } from 'lucide-react';
import { api } from '../api.js';
import { SafeHtml, FileChip } from '../components/ui.jsx';
import FileViewer from '../components/FileViewer.jsx';

const KINDS = [
  { key: 'form', label: 'Biểu mẫu', icon: FileText },
  { key: 'process', label: 'Quy trình / hướng dẫn', icon: Workflow },
];

/** Biểu mẫu và quy trình của nhóm đề xuất: người làm đề xuất đọc, xem trước và tải về để thực hiện theo. */
export default function GroupGuide({ groupId, guide, files = [], title = 'Biểu mẫu & quy trình thực hiện', className = 'card' }) {
  const [open, setOpen] = useState(null);
  if (!guide && !files.length) return null;
  const url = (f) => api.url(`/request-groups/${groupId}/files/${f.id}`);
  return (
    <section className={`${className} rq-guide`}>
      <h3 className="card-title"><BookOpen size={16} className="text-blue" /> {title}</h3>
      {guide && <SafeHtml html={guide} className="rq-guide-text" />}
      {KINDS.map((k) => {
        const list = files.filter((f) => f.kind === k.key);
        if (!list.length) return null;
        return (
          <div key={k.key} className="rq-guide-group">
            <small className="muted rq-guide-label"><k.icon size={13} /> {k.label}</small>
            <div className="attach-list">
              {list.map((f) => (
                <div key={f.id} className="attach-row">
                  <FileChip file={f} onOpen={() => setOpen(files.indexOf(f))} />
                  <a className="icon-btn sm" href={url(f)} title="Tải về"><Download size={14} /></a>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {open != null && (
        <FileViewer files={files} index={open} urlOf={url} onClose={() => setOpen(null)}
          publicUrlOf={async (f, share) => (await api.post(`/request-groups/${groupId}/files/${f.id}/link${share ? '?share=1' : ''}`)).url} />
      )}
    </section>
  );
}
