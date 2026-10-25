import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { BreakdownList, Heatmap, Legend, seriesColor } from '../components/charts';
import { ColorField } from '../components/designer/controls';
import { QrDesigner } from '../components/designer/QrDesigner';
import { DEFAULT_STYLE, PRESETS } from '../components/designer/presets';
import type { QrStyle } from '../lib/types';
import { mockApi, renderWithProviders } from './utils';

afterEach(() => vi.unstubAllGlobals());

describe('ColorField', () => {
  it('only emits complete hex colours', async () => {
    const onChange = vi.fn();
    render(<ColorField label="Foreground" value="#111827" onChange={onChange} />);
    const input = screen.getByLabelText('Foreground');
    await userEvent.clear(input);
    await userEvent.type(input, '#12');
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.type(input, '34AB');
    expect(onChange).toHaveBeenLastCalledWith('#1234ab');
  });

  it('can inherit', async () => {
    const onChange = vi.fn();
    render(<ColorField label="Centre" value="#ff0000" onChange={onChange} inheritLabel="Auto" />);
    await userEvent.click(screen.getByLabelText('Auto'));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

function DesignerHarness({ onStyle }: { onStyle: (s: QrStyle) => void }) {
  const [style, setStyle] = useState<QrStyle>(DEFAULT_STYLE);
  return (
    <QrDesigner
      value={style}
      onChange={(s) => {
        setStyle(s);
        onStyle(s);
      }}
      templates={[{ id: 't1', name: 'Brand', style: { ...DEFAULT_STYLE, modules: { shape: 'dots' } }, createdAt: '', updatedAt: '' }]}
    />
  );
}

describe('QrDesigner', () => {
  it('changes module and eye shapes', async () => {
    const onStyle = vi.fn();
    renderWithProviders(<DesignerHarness onStyle={onStyle} />);
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Module shape' })).getByRole('radio', { name: 'Rounded' }));
    expect(onStyle.mock.lastCall![0].modules.shape).toBe('rounded');
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Centre shape' })).getByRole('radio', { name: 'Diamond' }));
    expect(onStyle.mock.lastCall![0].eyes.innerShape).toBe('diamond');
    expect(within(screen.getByRole('radiogroup', { name: 'Module shape' })).getByRole('radio', { name: 'Rounded' })).toHaveAttribute('aria-checked', 'true');
  });

  it('switches to a gradient fill', async () => {
    const onStyle = vi.fn();
    renderWithProviders(<DesignerHarness onStyle={onStyle} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Linear' }));
    expect(onStyle.mock.lastCall![0].foreground).toMatchObject({ type: 'linear', from: '#111827', angle: 45 });
    expect(screen.getByLabelText('Gradient end')).toBeInTheDocument();
  });

  it('configures a call-to-action frame', async () => {
    const onStyle = vi.fn();
    renderWithProviders(<DesignerHarness onStyle={onStyle} />);
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Frame' })).getByRole('radio', { name: 'Card' }));
    const text = screen.getByLabelText('Text');
    await userEvent.clear(text);
    await userEvent.type(text, 'SCAN FOR MORE INFO');
    expect(onStyle.mock.lastCall![0].frame).toMatchObject({ style: 'card-pill', text: 'SCAN FOR MORE INFO' });
  });

  it('applies presets and saved templates', async () => {
    const onStyle = vi.fn();
    renderWithProviders(<DesignerHarness onStyle={onStyle} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fresh' }));
    expect(onStyle.mock.lastCall![0].eyes.innerShape).toBe('diamond');
    await userEvent.selectOptions(screen.getByLabelText('Apply a saved template'), 't1');
    expect(onStyle.mock.lastCall![0].modules.shape).toBe('dots');
  });

  it('uploads a logo and exposes logo options', async () => {
    const { calls } = mockApi({ 'POST /api/assets': { id: '00000000-0000-4000-8000-000000000009', filename: 'logo.png', mime: 'image/png', size: 4 } });
    const onStyle = vi.fn();
    renderWithProviders(<DesignerHarness onStyle={onStyle} />);
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Logo file'), { target: { files: [file] } });
    expect(await screen.findByText('Logo added')).toBeInTheDocument();
    expect(calls[0]!.body).toMatchObject({ filename: 'logo.png' });
    expect(onStyle.mock.lastCall![0].logo.assetId).toBe('00000000-0000-4000-8000-000000000009');
    expect(screen.getByRole('radiogroup', { name: 'Backing' })).toBeInTheDocument();
    expect(screen.getByText('Logos always use maximum error correction.')).toBeInTheDocument();
  });

  it('keeps every preset a complete style', () => {
    for (const p of PRESETS) {
      const s = p.style(DEFAULT_STYLE);
      expect(Object.keys(s).sort()).toEqual(Object.keys(DEFAULT_STYLE).sort());
    }
  });
});

describe('charts', () => {
  it('assigns colours by entity position and folds extras into "other"', () => {
    expect(seriesColor(0)).toBe('var(--series-1)');
    expect(seriesColor(7)).toBe('var(--series-8)');
    expect(seriesColor(8)).toBe('var(--series-other)');
  });

  it('renders breakdowns with shares', () => {
    render(<BreakdownList items={[{ key: 'mobile', hits: 3 }, { key: 'desktop', hits: 1 }]} />);
    expect(screen.getByText('mobile')).toBeInTheDocument();
    expect(screen.getByText('75%', { exact: false })).toBeInTheDocument();
  });

  it('shows an empty message', () => {
    render(<BreakdownList items={[]} empty="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('only shows a legend for multiple series', () => {
    const { rerender } = render(<Legend series={[{ key: 'a', label: 'A', colorIndex: 0 }]} />);
    expect(screen.queryByLabelText('Legend')).toBeNull();
    rerender(<Legend series={[{ key: 'a', label: 'A', colorIndex: 0 }, { key: 'b', label: 'B', colorIndex: 1 }]} />);
    expect(screen.getByLabelText('Legend')).toHaveTextContent('AB');
  });

  it('renders a 7x24 heatmap with tooltips', () => {
    render(<Heatmap cells={[{ dow: 1, hour: 9, hits: 4 }]} />);
    expect(screen.getAllByRole('row')).toHaveLength(8);
    expect(screen.getByTitle('Mon 09:00 – 4 scans')).toBeInTheDocument();
  });
});
