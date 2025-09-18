import { useMemo } from 'react';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardActions,
  CardContent,
  Chip,
  Grid,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { useQueries, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ApiClient } from '../api/client';
import { useSessionStore } from '../hooks/useSessionStore';

const sections = [
  { id: 'ai', label: 'Artificial Intelligence' },
  { id: 'ml', label: 'Machine Learning' },
  { id: 'iot', label: 'Internet of Things' },
  { id: 'quantum', label: 'Quantum Computing' },
];

export function HomePage() {
  const sessionId = useSessionStore((state) => state.sessionId);

  const newsQueries = useQueries({
    queries: sections.map((section) => ({
      queryKey: ['news', section.id, 'monthly'],
      queryFn: () => ApiClient.fetchNews(section.id, 'monthly'),
      staleTime: 1000 * 60 * 30,
    })),
  });

  const spotlightQuery = useQuery({
    queryKey: ['news', 'spotlight', 'daily'],
    queryFn: () => ApiClient.fetchNews('ai', 'daily'),
    staleTime: 1000 * 60 * 5,
  });

  const recommendationsQuery = useQuery({
    queryKey: ['recommendations', sessionId],
    enabled: Boolean(sessionId),
    queryFn: () => ApiClient.recommendations(sessionId),
    staleTime: 1000 * 60 * 60,
  });

  const spotlightItems = spotlightQuery.data?.items.slice(0, 3) ?? [];

  const isLoading = newsQueries.some((query) => query.isLoading);

  const recommendationChips = useMemo(
    () =>
      recommendationsQuery.data?.recommendations.map((recommendation) => ({
        label: recommendation.section.toUpperCase(),
        href: `/section/${recommendation.section}`,
        tooltip: recommendation.reason,
        score: recommendation.score,
      })) ?? [],
    [recommendationsQuery.data],
  );

  return (
    <Stack spacing={4}>
      <Box
        sx={{
          p: 3,
          borderRadius: 3,
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          boxShadow: 3,
        }}
      >
        <Typography variant="overline" sx={{ opacity: 0.8 }}>
          Today's Spotlight
        </Typography>
        {spotlightQuery.isLoading ? (
          <Skeleton variant="text" height={48} sx={{ bgcolor: 'rgba(255,255,255,0.2)' }} />
        ) : (
          <Stack spacing={2}>
            {spotlightItems.map((item) => (
              <Box key={item.id}>
                <Typography variant="h5" fontWeight={600} gutterBottom>
                  {item.title}
                </Typography>
                <Typography variant="body1" sx={{ opacity: 0.9 }}>
                  {item.summary}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.7 }}>
                  Updated {dayjs(item.publishedAt ?? spotlightQuery.data?.generatedAt).format('MMMM D, YYYY h:mm A')}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Box>

      {recommendationChips.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
          <Typography variant="subtitle2" color="text.secondary">
            Recommended deep dives
          </Typography>
          {recommendationChips.map((chip) => (
            <Chip
              key={chip.label}
              label={`${chip.label} • ${chip.score.toFixed(1)}`}
              component="a"
              href={chip.href}
              clickable
              color="secondary"
              variant="outlined"
            />
          ))}
        </Stack>
      )}

      <Grid container spacing={3}>
        {newsQueries.map((query, index) => {
          const section = sections[index];
          const items = query.data?.items ?? [];
          return (
            <Grid item xs={12} md={6} key={section.id}>
              <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <Typography variant="h6" fontWeight={600}>
                      {section.label}
                    </Typography>
                    <Chip
                      label={query.data?.verificationSummary ?? 'Awaiting verification'}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                  </Stack>
                  <Stack spacing={2} mt={2}>
                    {query.isLoading
                      ? Array.from({ length: 3 }).map((_, skeletonIndex) => (
                          <Skeleton key={skeletonIndex} variant="rectangular" height={72} sx={{ borderRadius: 2 }} />
                        ))
                      : items.slice(0, 3).map((item) => (
                          <Box key={item.id}>
                            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                              {item.title}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {item.summary}
                            </Typography>
                            <Stack direction="row" spacing={1} mt={1} alignItems="center">
                              <Chip label={`${item.verificationScore}% verified`} size="small" color="success" />
                              {item.sourceUrl && (
                                <Button size="small" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
                                  Source
                                </Button>
                              )}
                            </Stack>
                          </Box>
                        ))}
                  </Stack>
                </CardContent>
                <CardActions sx={{ mt: 'auto', justifyContent: 'space-between', px: 2, pb: 2 }}>
                  <Button component={CardActionArea} href={`/section/${section.id}`} sx={{ p: 0 }}>
                    Explore section
                  </Button>
                  <Button component={CardActionArea} href={`/archive/${section.id}/monthly`} sx={{ p: 0 }}>
                    View archive
                  </Button>
                </CardActions>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {isLoading && (
        <Typography variant="body2" color="text.secondary">
          Aggregating intelligence from trusted sources…
        </Typography>
      )}
    </Stack>
  );
}
