import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for use in Server Components, Server Actions, and route handlers.
 * It reads the logged-in user's session from cookies, so all queries run AS THAT USER
 * and Row-Level Security applies. This is the only place (with client.ts) that the rest
 * of the app obtains a Supabase client — see src/data/README.md.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        ) {
          // In Server Components cookies are read-only; the middleware refreshes the
          // session instead, so swallowing the error here is expected and safe.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // called from a Server Component — ignore.
          }
        },
      },
    },
  );
}
