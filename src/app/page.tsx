import { auth, signOut } from "@/auth";

// Per-user page: render at request time.
export const instant = false;

export default async function Home() {
  const session = await auth();
  const name = session?.user?.name?.split(" ")[0] ?? "there";

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <span className="text-lg font-semibold tracking-tight text-neutral-900">Glued</span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button className="text-sm text-neutral-500 hover:text-neutral-900">
            Sign out ({session?.user?.email})
          </button>
        </form>
      </div>

      <div className="mx-auto mt-16 max-w-5xl">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">Hi {name}</h1>
        <p className="mt-2 text-neutral-500">app.getglued.co is live. Only approved Glued accounts can see this page.</p>
      </div>
    </main>
  );
}
