import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CategoryManager } from '../components/CategoryManager';
import { useCmsApi, CmsApiError } from '../../../lib/cms-api';
import { useSession } from '../session-provider';

jest.mock('../../../lib/cms-api');
jest.mock('../session-provider');

describe('CategoryManager', () => {
  const mockGet = jest.fn();
  const mockPost = jest.fn();
  const mockPatch = jest.fn();
  const mockDel = jest.fn();
  const alertMock = jest.spyOn(window, 'alert').mockImplementation(() => {});
  const confirmMock = jest.spyOn(window, 'confirm').mockImplementation(() => true);

  beforeEach(() => {
    jest.clearAllMocks();
    (useCmsApi as jest.Mock).mockReturnValue({
      get: mockGet,
      post: mockPost,
      patch: mockPatch,
      del: mockDel,
    });
    mockGet.mockResolvedValue([]);
  });

  afterAll(() => {
    alertMock.mockRestore();
    confirmMock.mockRestore();
  });

  it('blocks UI and prevents GET without category.manage', async () => {
    (useSession as jest.Mock).mockReturnValue({
      permissions: [],
    });

    await act(async () => {
      render(<CategoryManager />);
    });

    expect(screen.getByText('You do not have permission to manage categories.')).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.queryByText('Add Category')).not.toBeInTheDocument();
  });

  it('allows CRUD operations with category.manage', async () => {
    (useSession as jest.Mock).mockReturnValue({
      permissions: ['category.manage'],
    });

    mockGet.mockResolvedValue([
      { id: '1', name: 'Tech', slug: 'tech', children: [] }
    ]);

    await act(async () => {
      render(<CategoryManager />);
    });

    expect(mockGet).toHaveBeenCalledWith('/v1/categories');
    expect(screen.getByText('Tech')).toBeInTheDocument();

    // Create
    await act(async () => {
      fireEvent.click(screen.getByText('Add Category'));
    });

    const nameInput = screen.getByLabelText('Name');
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'New Cat' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect(mockPost).toHaveBeenCalledWith('/v1/categories', expect.objectContaining({ name: 'New Cat' }));

    // Edit
    await act(async () => {
      fireEvent.click(screen.getByText('Edit'));
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect(mockPatch).toHaveBeenCalledWith('/v1/categories/1', expect.any(Object));

    // Delete
    await act(async () => {
      fireEvent.click(screen.getByText('Delete'));
    });

    expect(mockDel).toHaveBeenCalledWith('/v1/categories/1');
  });

  it('handles CATEGORY_SLUG_CONFLICT gracefully', async () => {
    (useSession as jest.Mock).mockReturnValue({
      permissions: ['category.manage'],
    });

    mockGet.mockResolvedValueOnce([]);

    await act(async () => {
      render(<CategoryManager />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Add Category'));
    });

    const nameInput = screen.getByLabelText('Name');
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'Duplicate' } });
    });

    const error = new CmsApiError(409, 'Conflict', 'CATEGORY_SLUG_CONFLICT');
    Object.assign(error, { code: 'CATEGORY_SLUG_CONFLICT', message: 'Conflict' });
    mockPost.mockRejectedValue(error);

    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect(alertMock).toHaveBeenCalledWith('A category with this slug already exists.');
  });
});
