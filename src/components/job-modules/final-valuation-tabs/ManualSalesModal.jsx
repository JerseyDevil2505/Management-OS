import React, { useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

/**
 * Manual Sales Modal for Microsystems vendors.
 * Allows appraiser to manually enter historical sales that aren't in the source data.
 * Entered sales are saved to pool_manual_sales table and included in the Sales Pool.
 * 
 * Props:
 *   isOpen, onClose
 *   jobData - { id, county }
 *   properties - all properties in the job
 *   onSaved - callback after save (parent should refresh)
 */
const ManualSalesModal = ({
  isOpen,
  onClose,
  jobData = {},
  properties = [],
  onSaved = () => {}
}) => {
  const [block, setBlock] = useState('');
  const [lot, setLot] = useState('');
  const [qualifier, setQualifier] = useState('');
  const [salesDate, setSalesDate] = useState('');
  const [salesPrice, setSalesPrice] = useState('');
  const [salesNu, setSalesNu] = useState('');
  const [salesBook, setSalesBook] = useState('');
  const [salesPage, setSalesPage] = useState('');
  const [manualSales, setManualSales] = useState([]); // List of added sales this session
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);

  const handleAddSale = useCallback(() => {
    if (!block.trim() || !lot.trim() || !salesDate.trim() || !salesPrice.trim()) {
      alert('Block, Lot, Sales Date, and Sales Price are required.');
      return;
    }
    const numPrice = parseFloat(salesPrice);
    if (isNaN(numPrice)) {
      alert('Sales Price must be a valid number.');
      return;
    }
    const newSale = {
      block: block.trim(),
      lot: lot.trim(),
      qualifier: qualifier.trim(),
      sales_date: salesDate,
      sales_price: numPrice,
      sales_nu: salesNu.trim() || null,
      sales_book: salesBook.trim() || null,
      sales_page: salesPage.trim() || null,
      tempId: Date.now()
    };
    setManualSales(prev => [...prev, newSale]);
    setBlock('');
    setLot('');
    setQualifier('');
    setSalesDate('');
    setSalesPrice('');
    setSalesNu('');
    setSalesBook('');
    setSalesPage('');
  }, [block, lot, qualifier, salesDate, salesPrice, salesNu, salesBook, salesPage]);

  const handleRemoveSale = useCallback((tempId) => {
    setManualSales(prev => prev.filter(s => s.tempId !== tempId));
  }, []);

  const handleSave = useCallback(async () => {
    if (manualSales.length === 0) {
      alert('No sales to save.');
      return;
    }
    if (!jobData?.id) {
      alert('Job ID is missing.');
      return;
    }
    setSaving(true);
    setSaveResult(null);
    try {
      const { supabase } = await import('../../../lib/supabaseClient');
      const rows = manualSales.map(sale => ({
        job_id: jobData.id,
        property_block: sale.block,
        property_lot: sale.lot,
        property_qualifier: sale.qualifier,
        sales_date: sale.sales_date,
        sales_price: sale.sales_price,
        sales_nu: sale.sales_nu,
        sales_book: sale.sales_book,
        sales_page: sale.sales_page
      }));
      const { error } = await supabase
        .from('pool_manual_sales')
        .insert(rows);
      if (error) throw error;
      setSaveResult({ success: true, count: rows.length });
      setManualSales([]);
      setTimeout(() => {
        onSaved();
        onClose();
      }, 1000);
    } catch (error) {
      console.error('❌ Error saving manual sales:', error);
      setSaveResult({ success: false, error: error.message });
    } finally {
      setSaving(false);
    }
  }, [manualSales, jobData, onSaved, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-xl font-bold text-gray-900">Add Manual Sales</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded"
            disabled={saving}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          <p className="text-sm text-gray-600 mb-4">
            Enter historical sales for Microsystems properties. These will be saved and included in the Sales Pool.
          </p>

          {/* Input Form */}
          <div className="bg-gray-50 border border-gray-200 rounded p-4 mb-6">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700">Block *</label>
                <input
                  type="text"
                  value={block}
                  onChange={(e) => setBlock(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  placeholder="e.g. 39"
                  disabled={saving}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700">Lot *</label>
                <input
                  type="text"
                  value={lot}
                  onChange={(e) => setLot(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  placeholder="e.g. 9"
                  disabled={saving}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700">Qualifier</label>
                <input
                  type="text"
                  value={qualifier}
                  onChange={(e) => setQualifier(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  placeholder="e.g. A"
                  disabled={saving}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700">Sales Date *</label>
                <input
                  type="date"
                  value={salesDate}
                  onChange={(e) => setSalesDate(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  disabled={saving}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700">Sales Price *</label>
                <input
                  type="number"
                  value={salesPrice}
                  onChange={(e) => setSalesPrice(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  placeholder="e.g. 225000"
                  disabled={saving}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700">Sales NU</label>
                <input
                  type="text"
                  value={salesNu}
                  onChange={(e) => setSalesNu(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  placeholder="e.g. 00"
                  disabled={saving}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700">Book</label>
                <input
                  type="text"
                  value={salesBook}
                  onChange={(e) => setSalesBook(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  disabled={saving}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700">Page</label>
                <input
                  type="text"
                  value={salesPage}
                  onChange={(e) => setSalesPage(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  disabled={saving}
                />
              </div>
            </div>
            <button
              onClick={handleAddSale}
              className="px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
              disabled={saving}
            >
              Add Sale
            </button>
          </div>

          {/* Added Sales List */}
          {manualSales.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">
                {manualSales.length} sale{manualSales.length !== 1 ? 's' : ''} to save
              </h3>
              <div className="space-y-2">
                {manualSales.map(sale => (
                  <div key={sale.tempId} className="bg-blue-50 border border-blue-200 rounded p-3 flex items-center justify-between">
                    <div className="text-sm">
                      <span className="font-medium text-gray-900">
                        {sale.block}/{sale.lot}{sale.qualifier ? '-' + sale.qualifier : ''}
                      </span>
                      <span className="text-gray-600 ml-3">
                        {new Date(sale.sales_date).toLocaleDateString()} • ${sale.sales_price.toLocaleString()}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveSale(sale.tempId)}
                      className="p-1 text-red-600 hover:bg-red-100 rounded"
                      disabled={saving}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {saveResult && (
            <div className={`p-3 rounded text-sm ${saveResult.success ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
              {saveResult.success
                ? `✅ ${saveResult.count} sale${saveResult.count !== 1 ? 's' : ''} saved successfully!`
                : `❌ Error: ${saveResult.error}`}
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 px-6 py-4 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded hover:bg-gray-50 disabled:bg-gray-100"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
            disabled={saving || manualSales.length === 0}
          >
            {saving ? 'Saving...' : 'Save Sales'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ManualSalesModal;
