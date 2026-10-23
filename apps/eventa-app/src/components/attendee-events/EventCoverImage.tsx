const fallback = '/event-cover-fallback.jpg';

export function EventCoverImage({ src, className, alt = '' }: { src?: string | undefined; className: string; alt?: string }) {
  return <img alt={alt} className={className} loading="lazy" onError={(event) => {
    if (!event.currentTarget.src.endsWith(fallback)) event.currentTarget.src = fallback;
  }} src={src ?? fallback} />;
}
