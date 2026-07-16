import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import {
  type AuthConfig,
  fetchAuthConfig,
  oidcLoginUrl,
} from "../../data/api";
import { useAuth } from "../../data/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);

  useEffect(() => {
    fetchAuthConfig().then(setAuthConfig);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      setError(null);
      try {
        await login(email, password);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Login failed");
      } finally {
        setSubmitting(false);
      }
    },
    [email, password, login],
  );

  // Default to showing the password form if the config call hasn't resolved
  // (or failed) so password login always remains reachable.
  const passwordLoginEnabled = authConfig?.password_login_enabled ?? true;
  const oidcEnabled = authConfig?.oidc_enabled ?? false;
  const providerLabel = authConfig?.oidc_provider_label ?? "SSO";

  return (
    <Box
      sx={{
        display: "flex",
        height: "100vh",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Box component="form" onSubmit={handleSubmit} sx={{ width: 360 }}>
        <Typography
          variant="h5"
          sx={{ fontWeight: 700, mb: 3, color: "primary.main" }}
        >
          Switch Gateway
        </Typography>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          {passwordLoginEnabled && (
            <>
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={submitting}
                startIcon={
                  submitting ? <CircularProgress size={16} /> : undefined
                }
              >
                Sign in
              </Button>
            </>
          )}
          {passwordLoginEnabled && oidcEnabled && <Divider>or</Divider>}
          {oidcEnabled && (
            <Button
              variant="outlined"
              fullWidth
              onClick={() => {
                window.location.href = oidcLoginUrl();
              }}
            >
              {`Log in with ${providerLabel}`}
            </Button>
          )}
        </Stack>
      </Box>
    </Box>
  );
}
