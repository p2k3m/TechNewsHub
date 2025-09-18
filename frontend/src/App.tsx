import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useNavigationType } from 'react-router-dom';
import {
  AppBar,
  Box,
  Container,
  CssBaseline,
  IconButton,
  Snackbar,
  Switch,
  ThemeProvider,
  Toolbar,
  Tooltip,
  Typography,
  createTheme,
} from '@mui/material';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloseIcon from '@mui/icons-material/Close';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { HeaderBanner } from './components/HeaderBanner';
import { GlobalSearch } from './components/GlobalSearch';
import { useSessionStore } from './hooks/useSessionStore';

const sections = [
  { id: 'ai', label: 'AI' },
  { id: 'ml', label: 'Machine Learning' },
  { id: 'iot', label: 'IoT' },
  { id: 'quantum', label: 'Quantum' },
];

const queryClient = new QueryClient();

function usePreferredMode(): ["light" | "dark", (mode: "light" | "dark") => void] {
  const [mode, setMode] = useState<"light" | "dark">(() => {
    if (typeof window === 'undefined') {
      return 'light';
    }
    const stored = window.localStorage.getItem('tnh-theme');
    if (stored === 'dark' || stored === 'light') {
      return stored;
    }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('tnh-theme', mode);
    }
  }, [mode]);

  return [mode, setMode];
}

export default function App() {
  const [mode, setMode] = usePreferredMode();
  const sessionId = useSessionStore((state) => state.sessionId);
  const [refreshToast, setRefreshToast] = useState<string | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const navigationType = useNavigationType();

  useEffect(() => {
    const endpoint = import.meta.env.VITE_WEBSOCKET_URL;
    if (!endpoint || typeof window === 'undefined') {
      return;
    }
    const ws = new WebSocket(`${endpoint}?sessionId=${sessionId}`);
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'refresh') {
          setRefreshToast('New curated intelligence is available. Refresh to view.');
        }
      } catch (error) {
        console.warn('Unable to parse websocket payload', error);
      }
    };
    ws.onopen = () => setSocket(ws);
    ws.onerror = () => setSocket(null);
    ws.onclose = () => setSocket(null);
    return () => {
      ws.close();
    };
  }, [sessionId]);

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode,
          primary: {
            main: mode === 'dark' ? '#5bd1ff' : '#004d99',
          },
          background: {
            default: mode === 'dark' ? '#0f172a' : '#f4f6fb',
            paper: mode === 'dark' ? '#1e293b' : '#ffffff',
          },
        },
        typography: {
          fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
        },
        shape: { borderRadius: 12 },
      }),
    [mode],
  );

  useEffect(() => {
    if (navigationType === 'POP') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [navigationType]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AppBar position="sticky" color="transparent" elevation={0} sx={{ borderBottom: (theme) => `1px solid ${theme.palette.divider}` }}>
          <Toolbar sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="h6" component={Link} to="/" sx={{ textDecoration: 'none', color: 'primary.main', fontWeight: 700 }}>
              TechNewsHub
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, width: '100%', justifyContent: 'flex-end' }}>
              <Box sx={{ display: { xs: 'none', md: 'flex' }, gap: 2 }}>
                {sections.map((section) => (
                  <NavLink
                    key={section.id}
                    to={`/section/${section.id}`}
                    style={{ textDecoration: 'none' }}
                  >
                    {({ isActive }) => (
                      <Typography
                        sx={{
                          fontWeight: isActive ? 700 : 500,
                          color: isActive ? 'primary.main' : 'text.secondary',
                        }}
                      >
                        {section.label}
                      </Typography>
                    )}
                  </NavLink>
                ))}
              </Box>
              <Box sx={{ flex: { xs: 1, md: '0 0 auto' } }}>
                <GlobalSearch />
              </Box>
              <Tooltip title={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`}>
                <Switch
                  color="primary"
                  checked={mode === 'dark'}
                  onChange={() => setMode(mode === 'dark' ? 'light' : 'dark')}
                  icon={<LightModeIcon />}
                  checkedIcon={<DarkModeIcon />}
                />
              </Tooltip>
            </Box>
          </Toolbar>
        </AppBar>
        <HeaderBanner />
        <Container maxWidth="lg" sx={{ py: 4 }}>
          <Outlet />
        </Container>
        <Snackbar
          open={Boolean(refreshToast)}
          message={refreshToast}
          autoHideDuration={6000}
          onClose={() => setRefreshToast(null)}
          action={
            <>
              {socket && (
                <IconButton size="small" color="inherit" onClick={() => socket.send(JSON.stringify({ type: 'ack-refresh' }))}>
                  <RefreshIcon fontSize="small" />
                </IconButton>
              )}
              <IconButton size="small" color="inherit" onClick={() => setRefreshToast(null)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </>
          }
        />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
