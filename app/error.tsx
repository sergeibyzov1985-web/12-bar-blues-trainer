"use client";

import { Button } from "@/components/ui/button";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col justify-center gap-4 px-6 py-16">
      <p className="text-xs tracking-[0.16em] text-muted-foreground uppercase">
        Двенадцать тактов
      </p>
      <h1 className="font-heading text-5xl leading-none">Страница споткнулась</h1>
      <p className="text-base leading-7">
        Звук и круг не собрались. Это не ошибка в блюзе — можно просто
        открыть страницу ещё раз.
      </p>
      <Button type="button" onClick={reset} className="h-11 w-fit px-4">
        Попробовать снова
      </Button>
    </main>
  );
}
