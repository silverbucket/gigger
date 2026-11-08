/** The account store the auth hook needs; Armadietto's FileTree provides it in Compose, `dev/storage.ts` in memory. */
export interface AuthStore {
  readAuth(username: string): Promise<unknown>;
  findUserByEmail(email: string): Promise<boolean>;
  createUser(user: {
    username: string;
    email: string;
    password: string;
  }): Promise<void>;
  removeUser(username: string): Promise<void>;
  authenticate(user: { username: string; password: string }): Promise<void>;
  authorize(
    clientId: string | undefined,
    username: string,
    permissions: Record<string, string[]>,
  ): Promise<string>;
  revokeAccess(username: string, token: string): Promise<void>;
  put(
    username: string,
    path: string,
    contentType: string,
    body: Buffer,
  ): Promise<{ created: boolean }>;
  get(
    username: string,
    path: string,
  ): Promise<{
    item?: { items?: Record<string, unknown>; value?: Buffer | Uint8Array };
  }>;
}
export type AuthResult = { status: number; body: Record<string, unknown> };
export function createAuthHandler(
  store: AuthStore,
  clientId: string | undefined,
): (action: string, input: Record<string, unknown>) => Promise<AuthResult>;
