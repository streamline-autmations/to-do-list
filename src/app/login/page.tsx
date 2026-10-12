import { redirect } from "next/navigation";
import { hasSession } from "@/lib/page-auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await hasSession()) redirect("/");
  return (
    <main className="flex min-h-dvh flex-col px-6 py-10 sm:px-12 sm:py-16">
      <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-between sm:mx-0 sm:ml-[max(0px,calc((100vw-72rem)/2))]">
        <p className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <span aria-hidden className="grid size-5 place-items-center rounded-[5px] bg-accent text-accent-ink">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6.2l2.4 2.4 4.6-4.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          TaskHub
        </p>
        <div>
          <h1 className="text-[2rem] leading-[1.1] font-semibold tracking-tight">Private task list.</h1>
          <p className="mt-3 text-ink2">Sign in to see your projects.</p>
          <LoginForm />
        </div>
        <p className="font-mono text-xs text-ink3">One list for you and your agents.</p>
      </div>
    </main>
  );
}
