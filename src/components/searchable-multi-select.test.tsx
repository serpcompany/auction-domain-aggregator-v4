import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { SearchableMultiSelect } from './searchable-multi-select';

afterEach(cleanup);
beforeAll(() => {
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    value: MouseEvent,
  });
});

describe('SearchableMultiSelect', () => {
  it('searches locally, adds and removes repeated values, and clears them', async () => {
    render(
      <>
        <form id="filters" aria-label="Target filters" />
        <SearchableMultiSelect
          form="filters"
          label="TLD"
          name="tld"
          options={[
            { value: 'com', label: '.com' },
            { value: 'net', label: '.net' },
          ]}
          defaultValues={['legacy']}
          searchable
        />
      </>,
    );
    const targetForm = screen.getByRole('form', {
      name: 'Target filters',
    }) as HTMLFormElement;
    expect(new FormData(targetForm).getAll('tld')).toEqual(['legacy']);

    const trigger = screen.getByRole('button', { name: 'TLD: legacy' });
    fireEvent.click(trigger);
    const search = await screen.findByRole('searchbox', {
      name: 'Search tld',
    });
    fireEvent.change(search, { target: { value: 'missing' } });
    expect(screen.getByText('No options found')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'net' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '.net' }));
    expect(new FormData(targetForm).getAll('tld')).toEqual(['legacy', 'net']);

    fireEvent.click(screen.getByRole('checkbox', { name: '.net' }));
    expect(new FormData(targetForm).getAll('tld')).toEqual(['legacy']);

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(new FormData(targetForm).getAll('tld')).toEqual([]);
  });
});
