import "@fontsource/dm-sans/300.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/dm-sans/900.css";

import { CssBaseline, GlobalStyles, ThemeProvider } from "@mui/material";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { GLOBAL_STYLE } from "./theme/global-style";
import { APP_THEME } from "./theme/theme";

const theme = APP_THEME();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme={theme} disableTransitionOnChange noSsr>
      <CssBaseline />
      <GlobalStyles styles={GLOBAL_STYLE} />
      <App />
    </ThemeProvider>
  </StrictMode>,
);
