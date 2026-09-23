/** The admin role value in public.users (the same check BUILT uses). */
export const isAdmin = (role: string | null | undefined) => role === 'admin';
