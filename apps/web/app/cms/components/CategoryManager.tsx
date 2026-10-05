'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useCmsApi, CmsApiError } from '../../../lib/cms-api';
import { CategorySummary } from '@dailystar/types';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { useSession } from '../session-provider';

export function CategoryManager() {
  const { get, post, patch, del } = useCmsApi();
  const { permissions } = useSession();
  const canManage = permissions.includes('category.manage');
  
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<CategorySummary | null>(null);
  const [formData, setFormData] = useState({ name: '', slug: '', parentId: '' });

  const fetchCategories = useCallback(async () => {
    try {
      setLoading(true);
      const data = await get<CategorySummary[]>('/v1/categories');
      setCategories(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, [get]);

  useEffect(() => {
    if (canManage) {
      fetchCategories();
    }
  }, [fetchCategories, canManage]);

  const handleOpenModal = (cat?: CategorySummary) => {
    if (cat) {
      setEditingCat(cat);
      setFormData({ name: cat.name, slug: cat.slug, parentId: cat.parentId || '' });
    } else {
      setEditingCat(null);
      setFormData({ name: '', slug: '', parentId: '' });
    }
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingCat) {
        await patch(`/v1/categories/${editingCat.id}`, {
          name: formData.name,
          slug: formData.slug || undefined,
          parentId: formData.parentId || null
        });
      } else {
        await post('/v1/categories', {
          name: formData.name,
          slug: formData.slug || undefined,
          parentId: formData.parentId || null
        });
      }
      setModalOpen(false);
      fetchCategories();
    } catch (err: any) {
      if (err instanceof CmsApiError) {
        if (err.code === 'CATEGORY_SLUG_CONFLICT' || err.message === 'CATEGORY_SLUG_CONFLICT') {
          alert('A category with this slug already exists.');
        } else if (err.code) {
          alert(`Error: ${err.code}`);
        } else {
          alert(`Error: ${err.message}`);
        }
      } else {
        alert(err.message || 'Save failed');
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this category?')) return;
    try {
      await del(`/v1/categories/${id}`);
      fetchCategories();
    } catch (err: any) {
      alert(err.message || 'Delete failed');
    }
  };

  if (!canManage) {
    return (
      <div className="p-4 bg-red-50 text-red-700 rounded">
        You do not have permission to manage categories.
      </div>
    );
  }

  const renderTree = (cats: CategorySummary[], level = 0) => {
    return cats.map(cat => (
      <React.Fragment key={cat.id}>
        <tr>
          <td className="px-6 py-4 whitespace-nowrap">
            <div style={{ paddingLeft: `${level * 1.5}rem` }} className="flex items-center">
              {level > 0 && <span className="text-gray-400 mr-2">└</span>}
              <span className="font-medium">{cat.name}</span>
            </div>
          </td>
          <td className="px-6 py-4 whitespace-nowrap text-gray-500">/{cat.slug}</td>
          <td className="px-6 py-4 whitespace-nowrap text-right">
            <Button size="sm" variant="ghost" onClick={() => handleOpenModal(cat)}>Edit</Button>
            <Button size="sm" variant="ghost" className="text-red-600 ml-2" onClick={() => handleDelete(cat.id)}>Delete</Button>
          </td>
        </tr>
        {cat.children && cat.children.length > 0 && renderTree(cat.children, level + 1)}
      </React.Fragment>
    ));
  };

  const flatCategories = (cats: CategorySummary[]): {id: string, name: string}[] => {
    return cats.reduce((acc, cat) => {
      acc.push({ id: cat.id, name: cat.name });
      if (cat.children) acc.push(...flatCategories(cat.children));
      return acc;
    }, [] as {id: string, name: string}[]);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Category Management</h1>
        <Button onClick={() => handleOpenModal()}>Add Category</Button>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-4">{error}</div>}

      {loading ? (
        <p>Loading categories...</p>
      ) : (
        <div className="bg-white border rounded shadow-sm overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase">Slug</th>
                <th className="px-6 py-3 text-right font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {categories.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-4 text-center text-gray-500">No categories found.</td>
                </tr>
              ) : (
                renderTree(categories)
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editingCat ? 'Edit Category' : 'New Category'}>
        <form onSubmit={handleSave} className="space-y-4 pt-2">
          <div>
            <label htmlFor="cat-name" className="block text-sm font-medium mb-1">Name</label>
            <input 
              id="cat-name"
              required
              type="text" 
              className="w-full border rounded px-3 py-2"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="cat-slug" className="block text-sm font-medium mb-1">Slug (optional)</label>
            <input 
              id="cat-slug"
              type="text" 
              className="w-full border rounded px-3 py-2"
              value={formData.slug}
              onChange={e => setFormData({ ...formData, slug: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="cat-parent" className="block text-sm font-medium mb-1">Parent Category</label>
            <select 
              id="cat-parent"
              className="w-full border rounded px-3 py-2"
              value={formData.parentId}
              onChange={e => setFormData({ ...formData, parentId: e.target.value })}
            >
              <option value="">None (Top Level)</option>
              {flatCategories(categories).filter(c => c.id !== editingCat?.id).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
