const appStoreUrl = "https://apps.apple.com/jp/app/we育/id6769981853"
const googlePlayUrl = "https://play.google.com/store/apps/details?id=com.weyuapp.app"

export function StoreBadges() {
  return (
    <div className="weiku-store-badges flex flex-wrap items-center gap-3" aria-label="We育をダウンロード">
      <a
        href={appStoreUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="App Store で We育 をダウンロード"
        className="weiku-store-badge inline-flex min-w-[168px] items-center gap-2.5 rounded-xl border border-white/20 bg-charcoal px-4 py-2.5 text-white transition-[transform,opacity] duration-150 hover:-translate-y-0.5 hover:opacity-90 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-grape"
      >
        <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true" className="weiku-store-badge__icon shrink-0"><path d="M17.564 12.727c-.026-2.636 2.155-3.9 2.253-3.962-1.226-1.794-3.133-2.04-3.813-2.069-1.625-.164-3.17.957-3.993.957-.822 0-2.093-.933-3.44-.908-1.77.026-3.4 1.03-4.31 2.615-1.838 3.187-.47 7.906 1.318 10.494.874 1.267 1.916 2.69 3.283 2.64 1.318-.053 1.814-.853 3.407-.853 1.593 0 2.04.853 3.434.827 1.418-.026 2.317-1.293 3.183-2.567 1.003-1.472 1.416-2.898 1.44-2.972-.031-.014-2.766-1.062-2.79-4.213-.026-2.635.001 0-.001 0zM14.99 4.86c.726-.88 1.216-2.104 1.082-3.323-1.046.043-2.313.696-3.063 1.576-.673.78-1.262 2.025-1.104 3.221 1.167.091 2.359-.594 3.085-1.474z"/></svg>
        <span className="weiku-store-badge__text flex flex-col leading-[1.1]"><span className="weiku-store-badge__label text-[10px] tracking-[0.02em] text-white/85">Download on the</span><span className="weiku-store-badge__name text-lg font-semibold">App Store</span></span>
      </a>
      <a
        href={googlePlayUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Google Play で We育 をダウンロード"
        className="weiku-store-badge inline-flex min-w-[168px] items-center gap-2.5 rounded-xl border border-white/20 bg-charcoal px-4 py-2.5 text-white transition-[transform,opacity] duration-150 hover:-translate-y-0.5 hover:opacity-90 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-grape"
      >
        <svg viewBox="0 0 512 512" width="24" height="24" aria-hidden="true" className="weiku-store-badge__icon shrink-0"><path fill="#00d1ff" d="M48 59.5c-4 4.3-6.3 10.9-6.3 19.6v354.2c0 8.7 2.3 15.3 6.5 19.4l1.2 1.1 198.4-198.4v-4.7L49.2 58.3z"/><path fill="#ffce00" d="M314 322.5l-66.2-66.3v-4.7l66.3-66.3 1.5.9 78.4 44.5c22.4 12.7 22.4 33.5 0 46.3l-78.4 44.6z"/><path fill="#ff3a44" d="M315.5 321.6L247.8 254 48 453.8c7.4 7.8 19.6 8.8 33.3 1L315.5 321.6"/><path fill="#00f076" d="M315.5 186.4L81.3 53.4C67.6 45.6 55.4 46.6 48 54.4L247.8 254z"/></svg>
        <span className="weiku-store-badge__text flex flex-col leading-[1.1]"><span className="weiku-store-badge__label text-[10px] tracking-[0.02em] text-white/85">GET IT ON</span><span className="weiku-store-badge__name text-lg font-semibold">Google Play</span></span>
      </a>
    </div>
  )
}