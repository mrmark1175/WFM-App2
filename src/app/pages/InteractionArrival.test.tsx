import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { InteractionArrival } from './InteractionArrival';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock fetch
global.fetch = vi.fn();

// Mock window.confirm
window.confirm = vi.fn();
// Mock window.alert
window.alert = vi.fn();

describe('InteractionArrival - Delete All Data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have a "Delete All Data" button that clears data after confirmation', async () => {
    // Mock initial fetch (empty data)
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([])
    });

    render(
      <MemoryRouter>
        <InteractionArrival />
      </MemoryRouter>
    );

    // 1. Find the "Delete All Data" button
    // It should appear after initial load or when not loading
    const deleteBtn = await screen.findByRole('button', { name: /delete all data/i }, { timeout: 2000 });
    expect(deleteBtn).toBeInTheDocument();

    // 2. Setup confirm mock
    (window.confirm as any).mockReturnValue(true);

    // 3. Setup delete API mock
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true })
    });

    // 4. Click the button
    fireEvent.click(deleteBtn);

    // 5. Verify confirm was called
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Are you sure you want to delete ALL data'));

    // 6. Verify the DELETE API was called
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/interaction-arrival/all'),
        expect.objectContaining({ method: 'DELETE' })
      );
    }, { timeout: 2000 });

    // 7. Verify alert was called
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('successfully'));
  });

  it('should clear data in the UI after a successful deletion', async () => {
    // 1. Start with some data
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        { interval_date: '2026-03-16', interval_index: 0, volume: 100, aht: 200 }
      ])
    });

    render(
      <MemoryRouter>
        <InteractionArrival />
      </MemoryRouter>
    );

    const deleteBtn = await screen.findByRole('button', { name: /delete all data/i }, { timeout: 2000 });
    
    // Switch to volume tab if not already (it is by default)
    // Check if cell has value
    await waitFor(() => {
      const input = screen.getByDisplayValue('100');
      expect(input).toBeInTheDocument();
    });

    // 2. Click Delete All
    (window.confirm as any).mockReturnValue(true);
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true })
    });

    fireEvent.click(deleteBtn);

    // 3. Verify data is gone from UI
    await waitFor(() => {
      const inputs = screen.queryAllByDisplayValue('100');
      expect(inputs.length).toBe(0);
    });

    // 4. Check Distribution Tab
    const distTabBtn = screen.getByRole('button', { name: /distribution/i });
    fireEvent.click(distTabBtn);

    expect(screen.getByText(/no data loaded yet/i)).toBeInTheDocument();
  });

  it('should allow pulling a date range from telephony', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([])
    });

    render(
      <MemoryRouter>
        <InteractionArrival />
      </MemoryRouter>
    );

    // 1. Open Pull Modal
    const openPullBtn = await screen.findByRole('button', { name: /pull from telephony/i });
    fireEvent.click(openPullBtn);

    // 2. Verify range fields exist
    // These are expected to FAIL initially
    const startDateInput = screen.getByLabelText(/start date/i);
    const endDateInput = screen.getByLabelText(/end date/i);
    expect(startDateInput).toBeInTheDocument();
    expect(endDateInput).toBeInTheDocument();

    // 3. Fill out the range
    fireEvent.change(startDateInput, { target: { value: '2026-03-16' } });
    fireEvent.change(endDateInput, { target: { value: '2026-03-17' } });

    // 4. Mock the pull response for 2 days
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        data: {
          '2026-03-16': Array.from({ length: 96 }, (_, i) => ({ interval_index: i, volume: 10, aht: 200 })),
          '2026-03-17': Array.from({ length: 96 }, (_, i) => ({ interval_index: i, volume: 15, aht: 210 }))
        }
      })
    });

    // 5. Click Pull
    const pullBtn = screen.getByRole('button', { name: /pull data/i });
    fireEvent.click(pullBtn);

    // 6. Verify API was called with range
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/telephony/pull'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"startDate":"2026-03-16"')
        })
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/telephony/pull'),
        expect.objectContaining({
          body: expect.stringContaining('"endDate":"2026-03-17"')
        })
      );
    });

    // 7. Verify UI updated for both days
    await waitFor(() => {
      expect(screen.getAllByDisplayValue('10').length).toBeGreaterThan(0);
      expect(screen.getAllByDisplayValue('15').length).toBeGreaterThan(0);
    });
  });
});
