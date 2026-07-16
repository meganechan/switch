import { createTheme } from "@mui/material";
import type { PaletteOptions } from "@mui/material";

declare module "@mui/material/styles" {
  interface TypeBackground {
    nav?: string;
  }
}

const PRIMARY = "#A1C9D2";
const TEXT_PRIMARY = "#F2F2F2";
const TEXT_SECONDARY = "#F2F2F2B3";
const TEXT_DISABLED = "rgba(242, 242, 242, 0.5)";

const PALETTE: Partial<PaletteOptions> = {
  contrastThreshold: 4.5,
  primary: { main: PRIMARY },
  background: { default: "#0A0C0D", nav: "#0E0F0F", paper: "#121415" },
  text: { primary: TEXT_PRIMARY, secondary: TEXT_SECONDARY, disabled: TEXT_DISABLED },
  divider: "#FFFFFF14",
  action: { disabled: TEXT_DISABLED },
};

export const APP_THEME = () => {
  return createTheme({
    cssVariables: true,
    palette: { mode: "dark", ...PALETTE },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: "DM Sans, sans-serif",
      allVariants: { letterSpacing: "-0.02em" },
      button: { textTransform: "none" },
      body1: { fontSize: "0.9375rem" },
      body2: { fontSize: "0.875rem" },
    },
    components: {
      MuiAccordion: {
        styleOverrides: { root: { backgroundColor: "inherit" } },
      },
      MuiButtonBase: {
        styleOverrides: { root: { fontFamily: "inherit" } },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            variants: [
              {
                props: { variant: "outlined", color: "inherit" },
                style: { borderColor: "var(--mui-palette-action-selected)" },
              },
            ],
          },
        },
      },
      MuiCard: {
        defaultProps: {
          variant: "elevation",
          elevation: 1,
          sx: { p: 1 },
        },
      },
      MuiChip: {
        styleOverrides: { root: { height: "1.75rem" } },
      },
      MuiDrawer: {
        defaultProps: {
          elevation: 0,
          slotProps: {
            backdrop: { sx: { backgroundColor: "rgba(0, 0, 0, 0.75)" } },
          },
        },
      },
      MuiIconButton: {
        defaultProps: { size: "small" },
      },
      MuiPaper: {
        defaultProps: { variant: "outlined", elevation: 0 },
        styleOverrides: { root: { backgroundImage: "none" } },
      },
      MuiPopover: {
        defaultProps: { elevation: 0 },
      },
      MuiSvgIcon: {
        defaultProps: { fontSize: "inherit" },
      },
      MuiTab: {
        styleOverrides: { root: { minWidth: "auto" } },
      },
      MuiTextField: {
        defaultProps: { size: "small", fullWidth: true, variant: "outlined" },
      },
      MuiTooltip: {
        defaultProps: { arrow: true },
        styleOverrides: {
          tooltip: { fontSize: "0.875rem", textAlign: "center" },
        },
      },
    },
  });
};
