import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box,
  Button,
  Chip,
  Divider,
  Grid,
  LinearProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ApiClient, NewsItem, PatentItem } from '../api/client';
import { DeepDiveDialog } from '../components/DeepDiveDialog';

const periods = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
];

export function SectionPage() {
  const params = useParams();
  const sectionId = params.sectionId ?? 'ai';
  const [period, setPeriod] = useState<string>('daily');
  const [selectedItem, setSelectedItem] = useState<NewsItem | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);

  const newsQuery = useQuery({
    queryKey: ['news', sectionId, period],
    queryFn: () => ApiClient.fetchNews(sectionId, period),
    staleTime: 1000 * 60 * 10,
  });

  const patentsQuery = useQuery({
    queryKey: ['patents', sectionId, period],
    queryFn: () => ApiClient.fetchPatents(sectionId, period),
    staleTime: 1000 * 60 * 60,
  });

  const handleDeepDive = (item: NewsItem) => {
    setSelectedItem(item);
    setDialogOpen(true);
  };

  const handleChange = (_: React.MouseEvent<HTMLElement>, value: string | null) => {
    if (value) {
      setPeriod(value);
    }
  };

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom textTransform="capitalize">
            {sectionId.replace('-', ' ')} intelligence
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Explore {sectionId.toUpperCase()} breakthroughs with AI-assisted verification, curated for the {period} horizon.
          </Typography>
        </Box>
        <ToggleButtonGroup value={period} exclusive onChange={handleChange} size="small" color="primary">
          {periods.map((option) => (
            <ToggleButton key={option.id} value={option.id}>
              {option.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      {newsQuery.isLoading && <LinearProgress color="primary" />}

      <Grid container spacing={3}>
        <Grid item xs={12} md={7}>
          <Stack spacing={3}>
            {newsQuery.data?.items.map((item) => (
              <Stack key={item.id} spacing={1} sx={{ p: 3, borderRadius: 3, bgcolor: 'background.paper', boxShadow: 1 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="h6" fontWeight={600}>
                    {item.title}
                  </Typography>
                  <Chip label={`${item.verificationScore}%`} color="success" size="small" />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {item.summary}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Typography variant="caption" color="text.secondary">
                    {dayjs(item.publishedAt ?? newsQuery.data?.generatedAt).format('MMM D, YYYY h:mm A')}
                  </Typography>
                  {item.sourceUrl && (
                    <Button size="small" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
                      Source
                    </Button>
                  )}
                  <Button size="small" onClick={() => handleDeepDive(item)}>
                    Deep dive
                  </Button>
                </Stack>
              </Stack>
            ))}
            {newsQuery.isError && (
              <Typography variant="body2" color="error">
                Unable to load curated news. Please verify API credentials.
              </Typography>
            )}
          </Stack>
        </Grid>
        <Grid item xs={12} md={5}>
          <Stack spacing={2} sx={{ p: 3, borderRadius: 3, bgcolor: 'background.paper', boxShadow: 1 }}>
            <Typography variant="h6" fontWeight={600}>
              Patent intelligence
            </Typography>
            <Divider />
            {patentsQuery.isLoading && <LinearProgress color="secondary" />}
            {patentsQuery.data?.patents.map((patent: PatentItem) => (
              <Box key={patent.id}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {patent.title}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {patent.abstract}
                </Typography>
                <Stack direction="row" spacing={1} mt={1} flexWrap="wrap" alignItems="center">
                  <Chip label={`Impact ${patent.impactScore}`} size="small" color="primary" variant="outlined" />
                  {patent.filingDate && (
                    <Chip label={dayjs(patent.filingDate).format('MMM D, YYYY')} size="small" color="secondary" />
                  )}
                  {patent.inventors && patent.inventors.length > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      Inventors: {patent.inventors.join(', ')}
                    </Typography>
                  )}
                </Stack>
              </Box>
            ))}
            {patentsQuery.isError && (
              <Typography variant="body2" color="error">
                Patent insights unavailable. Check integration status.
              </Typography>
            )}
          </Stack>
        </Grid>
      </Grid>

      <DeepDiveDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        section={sectionId}
        period={period}
        item={selectedItem}
      />
    </Stack>
  );
}
