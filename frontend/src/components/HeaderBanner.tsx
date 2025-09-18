import { useMemo } from 'react';
import { Avatar, Box, Button, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import CloudIcon from '@mui/icons-material/Cloud';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import ThunderstormIcon from '@mui/icons-material/Thunderstorm';
import { useGeoPersonalization } from '../hooks/useGeoPersonalization';
import { useProfile } from '../hooks/useProfile';

function resolveWeatherIcon(weather: string) {
  const normalized = weather.toLowerCase();
  if (normalized.includes('storm')) return ThunderstormIcon;
  if (normalized.includes('snow')) return AcUnitIcon;
  if (normalized.includes('cloud')) return CloudIcon;
  return WbSunnyIcon;
}

export function HeaderBanner() {
  const { personalization, isLoading: geoLoading } = useGeoPersonalization();
  const { displayName, isLoading: profileLoading } = useProfile();

  const WeatherIcon = useMemo(() => resolveWeatherIcon(personalization?.weather ?? ''), [personalization?.weather]);

  const loginUrl = import.meta.env.VITE_COGNITO_LOGIN_URL;

  return (
    <Box
      component="header"
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        justifyContent: 'space-between',
        alignItems: { xs: 'flex-start', md: 'center' },
        gap: 2,
        p: 2,
        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        background: (theme) => theme.palette.background.paper,
      }}
    >
      <Stack direction="row" spacing={2} alignItems="center">
        <Avatar sx={{ bgcolor: 'primary.main', width: 56, height: 56 }}>TNH</Avatar>
        <Box>
          <Typography variant="h5" fontWeight={600} gutterBottom>
            {displayName ? `Welcome, ${displayName}` : 'TechNewsHub'}
          </Typography>
          {geoLoading ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">
                Personalizing your briefing…
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {personalization
                ? `${personalization.day}, ${personalization.date} · ${personalization.location}`
                : 'Stay informed with AI-verified technology intelligence.'}
            </Typography>
          )}
        </Box>
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', md: 'center' }}>
        {personalization && (
          <Chip
            icon={<WeatherIcon fontSize="small" />}
            label={`${personalization.weather} · ${personalization.temperature}`}
            color="primary"
            variant="outlined"
            sx={{ fontWeight: 500 }}
          />
        )}
        {profileLoading && <CircularProgress size={18} />}
        {!displayName && loginUrl && (
          <Button
            variant="contained"
            color="primary"
            onClick={() => {
              window.location.href = loginUrl;
            }}
          >
            Sign in with Google
          </Button>
        )}
      </Stack>
    </Box>
  );
}
