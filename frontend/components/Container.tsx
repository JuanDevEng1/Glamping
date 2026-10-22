export function Container({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`mx-auto w-full max-w-[1200px] px-4 sm:px-8 lg:px-16 ${className}`}>
      {children}
    </div>
  );
}
