import { useSearchParams } from 'react-router';
import { BarChart3, Link2, Palette } from 'lucide-react';
import { Logo } from '../components/AppLayout';

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 21 21" className="size-4" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const returnTo = params.get('returnTo') ?? '/app';
  const features = [
    { icon: Link2, title: 'Editable short links', text: 'Change where printed codes point at any time.' },
    { icon: Palette, title: 'On-brand QR codes', text: 'Logos, colours, shapes and call-to-action frames.' },
    { icon: BarChart3, title: 'Know what works', text: 'Compare scans by event, flyer or placement.' },
  ];
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Logo />
          <h1 className="mt-10 text-3xl font-semibold tracking-tight text-fg">Sign in</h1>
          <p className="mt-2 text-sm text-muted">Use your work Microsoft account to continue.</p>
          <a
            href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}
            className="mt-8 flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-border-strong bg-surface text-sm font-semibold text-fg shadow-xs transition hover:bg-surface-2"
          >
            <MicrosoftMark />
            Sign in with Microsoft
          </a>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-accent lg:flex lg:items-center lg:justify-center">
        <div className="absolute inset-0 opacity-15 [background-image:radial-gradient(white_1.5px,transparent_1.5px)] [background-size:22px_22px]" />
        <div className="relative max-w-md space-y-6 p-12 text-white">
          {features.map((f) => (
            <div key={f.title} className="flex gap-4 rounded-2xl bg-white/10 p-5 backdrop-blur">
              <f.icon className="mt-0.5 size-5 shrink-0" />
              <div>
                <div className="font-semibold">{f.title}</div>
                <div className="mt-1 text-sm text-white/80">{f.text}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
