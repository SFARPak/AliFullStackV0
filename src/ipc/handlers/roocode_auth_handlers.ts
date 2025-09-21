import { ipcMain, shell } from "electron";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { app } from "electron";
import log from "electron-log";
import { getUserDataPath } from "../../paths/paths";

const logger = log.scope("roocode-auth");

// Configuration - similar to Roo Code
const CLERK_BASE_URL = process.env.CLERK_BASE_URL || "https://clerk.roocode.com";
const ROO_CODE_API_URL = process.env.ROO_CODE_API_URL || "https://app.roocode.com";

// Storage for auth state and credentials
const AUTH_STATE_KEY = "roocode-auth-state";
const AUTH_CREDENTIALS_KEY = "roocode-auth-credentials";

interface AuthCredentials {
  clientToken: string;
  sessionId: string;
  organizationId?: string | null;
}

interface AuthState {
  isAuthenticated: boolean;
  userInfo?: {
    id?: string;
    name?: string;
    email?: string;
    picture?: string;
    organizationId?: string;
    organizationName?: string;
  };
}

let currentAuthState: AuthState = { isAuthenticated: false };

function getAuthStoragePath(): string {
  return path.join(getUserDataPath(), "roocode-auth.json");
}

function saveAuthData(data: { credentials?: AuthCredentials; state?: AuthState }): void {
  try {
    const existing = loadAuthData();
    const updated = { ...existing, ...data };
    fs.writeFileSync(getAuthStoragePath(), JSON.stringify(updated, null, 2));
  } catch (error) {
    logger.error("Failed to save auth data:", error);
  }
}

function loadAuthData(): { credentials?: AuthCredentials; state?: AuthState } {
  try {
    const filePath = getAuthStoragePath();
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (error) {
    logger.error("Failed to load auth data:", error);
  }
  return {};
}

export function getStoredCredentials(): AuthCredentials | null {
  const data = loadAuthData();
  return data.credentials || null;
}

function getStoredState(): AuthState {
  const data = loadAuthData();
  return data.state || { isAuthenticated: false };
}

// Clerk API functions (simplified version based on Roo Code's implementation)
async function clerkSignIn(ticket: string): Promise<AuthCredentials> {
  const formData = new URLSearchParams();
  formData.append("strategy", "ticket");
  formData.append("ticket", ticket);

  const response = await fetch(`${CLERK_BASE_URL}/v1/client/sign_ins`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "AliFullStack/1.0.0",
    },
    body: formData.toString(),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  const clientToken = response.headers.get("authorization");

  if (!clientToken) {
    throw new Error("No authorization header found in the response");
  }

  return {
    clientToken,
    sessionId: data.response.created_session_id,
  };
}

export async function clerkCreateSessionToken(credentials: AuthCredentials): Promise<string> {
  const formData = new URLSearchParams();
  formData.append("_is_native", "1");

  const response = await fetch(`${CLERK_BASE_URL}/v1/client/sessions/${credentials.sessionId}/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${credentials.clientToken}`,
      "User-Agent": "AliFullStack/1.0.0",
    },
    body: formData.toString(),
    signal: AbortSignal.timeout(10000),
  });

  if (response.status === 401 || response.status === 404) {
    throw new Error("Invalid session");
  } else if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  return data.jwt;
}

async function clerkGetUserInfo(credentials: AuthCredentials): Promise<any> {
  const response = await fetch(`${CLERK_BASE_URL}/v1/me`, {
    headers: {
      Authorization: `Bearer ${credentials.clientToken}`,
      "User-Agent": "AliFullStack/1.0.0",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const payload = await response.json();
  return payload.response;
}

// Authentication handlers
async function handleRooCodeLogin(): Promise<void> {
  try {
    // Generate a cryptographically random state parameter
    const state = crypto.randomBytes(16).toString("hex");

    // Store state for verification
    const authData = loadAuthData();
    (authData as any)[AUTH_STATE_KEY] = state;
    saveAuthData(authData);

    // Generate authorization URL
    const params = new URLSearchParams({
      state,
      auth_redirect: `dyad://roocode-auth`,
    });

    const authUrl = `${ROO_CODE_API_URL}/extension/sign-in?${params.toString()}`;

    logger.info(`Attempting to open authentication URL: ${authUrl}`);

    // For development/demo purposes, we'll simulate successful authentication
    // In production, this would open the browser for real authentication
    if (process.env.NODE_ENV === 'development') {
      logger.info("Development mode: Simulating successful authentication");
      // Simulate authentication callback after a short delay
      setTimeout(() => {
        const mockCode = 'dev-auth-code-' + Date.now();
        const mockState = state;
        // Trigger the callback as if the user completed authentication
        handleRooCodeCallback(mockCode, mockState).catch(err => {
          logger.error("Mock authentication callback failed:", err);
        });
      }, 2000);
      return;
    }

    // Open browser for authentication
    try {
      await shell.openExternal(authUrl);
      logger.info("Opened Roo Code authentication URL in browser");
    } catch (shellError) {
      logger.error("shell.openExternal failed:", shellError);
      throw new Error(`Failed to open authentication browser: ${shellError}`);
    }
  } catch (error) {
    logger.error("Failed to initiate Roo Code login:", error);
    throw new Error(`Failed to initiate Roo Code authentication: ${error}`);
  }
}

async function handleRooCodeCallback(code: string, state: string): Promise<void> {
  try {
    // Verify state parameter
    const authData = loadAuthData();
    const storedState = (authData as any)[AUTH_STATE_KEY];

    if (state !== storedState) {
      throw new Error("Invalid state parameter. Authentication request may have been tampered with.");
    }

    // Exchange code for credentials
    // For development mode with mock codes, create mock credentials
    let credentials: AuthCredentials;
    if (code.startsWith('dev-auth-code-')) {
      logger.info("Using mock credentials for development");
      credentials = {
        clientToken: 'mock-client-token-' + Date.now(),
        sessionId: 'mock-session-id-' + Date.now(),
      };
    } else {
      credentials = await clerkSignIn(code);
    }

    // Save credentials
    saveAuthData({ credentials });

    // Update auth state
    currentAuthState = { isAuthenticated: true };

    logger.info("Successfully authenticated with Roo Code");
  } catch (error) {
    logger.error("Failed to handle Roo Code callback:", error);
    currentAuthState = { isAuthenticated: false };
    throw error;
  }
}

async function handleRooCodeLogout(): Promise<void> {
  try {
    const credentials = getStoredCredentials();
    if (credentials) {
      // Optional: Call Clerk logout endpoint
      try {
        const formData = new URLSearchParams();
        formData.append("_is_native", "1");

        await fetch(`${CLERK_BASE_URL}/v1/client/sessions/${credentials.sessionId}/remove`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Bearer ${credentials.clientToken}`,
            "User-Agent": "AliFullStack/1.0.0",
          },
          body: formData.toString(),
          signal: AbortSignal.timeout(5000),
        });
      } catch (error) {
        logger.warn("Failed to call Clerk logout endpoint:", error);
      }
    }

    // Clear stored data
    const filePath = getAuthStoragePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    currentAuthState = { isAuthenticated: false };
    logger.info("Logged out from Roo Code");
  } catch (error) {
    logger.error("Failed to logout from Roo Code:", error);
    throw error;
  }
}

async function handleRooCodeAuthStatus(): Promise<AuthState> {
  try {
    const credentials = getStoredCredentials();

    if (!credentials) {
      return { isAuthenticated: false };
    }

    // Try to get a fresh session token to verify authentication
    // For mock credentials, skip the API calls
    let userInfo: any;
    if (credentials.clientToken.startsWith('mock-client-token-')) {
      logger.info("Using mock user info for development");
      userInfo = {
        id: 'dev-user-id',
        first_name: 'Dev',
        last_name: 'User',
        email_addresses: [{
          id: 'primary-email-id',
          email_address: 'dev@example.com'
        }],
        primary_email_address_id: 'primary-email-id',
        image_url: 'https://via.placeholder.com/150'
      };
    } else {
      try {
        await clerkCreateSessionToken(credentials); // Verify credentials are still valid
        userInfo = await clerkGetUserInfo(credentials);
      } catch (error) {
        logger.warn("Failed to refresh session token, treating as unauthenticated:", error);
        // Clear invalid credentials
        const filePath = getAuthStoragePath();
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        return { isAuthenticated: false };
      }
    }

    const authState: AuthState = {
      isAuthenticated: true,
      userInfo: {
        id: userInfo.id,
        name: [userInfo.first_name, userInfo.last_name].filter(n => n).join(" ") || undefined,
        email: userInfo.email_addresses?.find((e: any) => e.id === userInfo.primary_email_address_id)?.email_address,
        picture: userInfo.image_url,
      },
    };

    currentAuthState = authState;
    return authState;
  } catch (error) {
    logger.error("Failed to get auth status:", error);
    return { isAuthenticated: false };
  }
}

// Register IPC handlers
export function registerRooCodeAuthHandlers(): void {
  ipcMain.handle("roocode:login", async () => {
    await handleRooCodeLogin();
  });

  ipcMain.handle("roocode:logout", async () => {
    await handleRooCodeLogout();
  });

  ipcMain.handle("roocode:auth-status", async () => {
    return await handleRooCodeAuthStatus();
  });

  // Handle deep link callback for authentication
  ipcMain.handle("roocode:auth-callback", async (_, code: string, state: string) => {
    await handleRooCodeCallback(code, state);
  });
}
