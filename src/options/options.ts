import { AuthError, getAuthState, isOAuthConfigured, saveToken, signInWithOAuth, signOut } from '../core/auth';

const form = document.querySelector<HTMLFormElement>('#pat-form');
const tokenInput = document.querySelector<HTMLInputElement>('#token');
const remember = document.querySelector<HTMLInputElement>('#remember');
const status = document.querySelector<HTMLElement>('#account-status');
const message = document.querySelector<HTMLElement>('#form-message');
const signOutButton = document.querySelector<HTMLButtonElement>('#sign-out');
const oauthButton = document.querySelector<HTMLButtonElement>('#oauth-sign-in');
const oauthCopy = document.querySelector<HTMLElement>('#oauth-copy');

const setMessage = (value: string): void => { if (message) message.textContent = value; };

const renderAccount = async (): Promise<void> => {
  const state = await getAuthState();
  if (status) status.textContent = state.signedIn
    ? `Signed in${state.userSlug ? ` as ${state.userSlug}` : ''}${state.tier ? ` · ${state.tier}` : ''}.`
    : 'Not signed in.';
  if (signOutButton) signOutButton.hidden = !state.signedIn;
};

if (oauthButton) {
  const configured = isOAuthConfigured();
  oauthButton.disabled = !configured;
  if (configured && oauthCopy) oauthCopy.textContent = 'Sign in with a read-only Are.na OAuth connection.';
  oauthButton.addEventListener('click', async () => {
    setMessage('Opening Are.na sign-in…');
    try {
      await signInWithOAuth(remember?.checked === true);
      setMessage('Signed in.');
      await renderAccount();
    } catch (error) {
      setMessage(error instanceof AuthError ? error.message : 'Could not sign in with Are.na.');
    }
  });
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!tokenInput) return;
  setMessage('Checking token…');
  try {
    await saveToken(tokenInput.value, remember?.checked === true);
    tokenInput.value = '';
    setMessage('Signed in.');
    await renderAccount();
  } catch (error) {
    setMessage(error instanceof AuthError ? error.message : 'Could not sign in.');
  }
});

signOutButton?.addEventListener('click', async () => {
  await signOut();
  setMessage('Signed out locally. Delete the token in Are.na settings to revoke it.');
  await renderAccount();
});

void renderAccount();
