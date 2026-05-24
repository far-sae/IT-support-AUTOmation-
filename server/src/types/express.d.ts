import type { Role } from "@prisma/client";

// Augment Express's User interface (which is what `req.user` is typed as,
// since passport's types declare `Request.user?: Express.User`).
declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      role: Role;
      name: string;
      organizationId: string;
      organizationSlug: string;
      isPlatformAdmin: boolean;
    }
  }
}

export {};
