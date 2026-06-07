import React, { useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';

/**
 * Manual Sales Modal for Microsystems vendors.
 * Links manual sales to existing properties in the job, overriding their source sales.
 * Similar to BRT's unmask feature.
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
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const [salesDate, setSalesDate] = useState('');
  const [salesPrice, setSalesPrice] = useState('');
  const [salesNu, setSalesNu] = useState('');
  const [salesBook, setSalesBook] = useState('');
  const [salesPage, setSalesPage] = useState('');

  const [manualSales, setManualSales] = useState([]); // List of overrides this session
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);

  // Get unique properties (main card only) for selection
  const uniqueProperties = (() => {
    const seen = new Set();
    return properties.filter(p => {
      const baseKey = `${p.property_block}-${p.property_lot}-${p.property_qualifier || ''}`;
      if (seen.has(baseKey)) return false;
      seen.add(baseKey);
      // Only properties with sales data can be overridden
      return p.sales_date;
    });
  })();

  // Filter properties by search text
  const filteredProperties = uniqueProperties.filter(p => {
    const text = searchText.toLowerCase();
    return (
      p.property_block?.toLowerCase().includes(text) ||
      p.property_lot?.toLowerCase().includes(text) ||
      (p.property_qualifier || '').toLowerCase().includes(text)
    );
  });

  const handleAddSale = useCallback(() => {
    if (!selectedProperty) {
      alert('Please select a property from the job.');
      return;
    }
    if (!salesDate.trim() || !salesPrice.trim()) {
      alert('Sales Date and Sales Price are required.');
      return;
    }
    const numPrice = parseFloat(salesPrice);
    if (isNaN(numPrice)) {
      alert('Sales Price must be a valid number.');
      return;
    }
    const newSale = {
      property_block: selectedProperty.property_block,
      property_lot: selectedProperty.property_lot,
      property_qualifier: selectedProperty.property_qualifier || '',
      current_sales_price: selectedProperty.sales_price,
      current_sales_date: selectedProperty.sales_date,
      sales_date: salesDate,
      sales_price: numPrice,
      sales_nu: salesNu.trim() || null,
      sales_book: salesBook.trim() || null,
      sales_page: salesPage.trim() || null,
      tempId: Date.now()
    };
    setManualSales(prev => [...prev, newSale]);
    setSelectedProperty(null);
    setSearchText('');
    setSalesDate('');
    setSalesPrice('');
    setSalesNu('');
    setSalesBook('');
    setSalesPage('');
  }, [selectedProperty, salesDate, salesPrice, salesNu, salesBook, salesPage]);

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

      // Step 1: Update property_records directly with the override data (like BRT's unmasked sales)
      // This ensures the override is used everywhere: pool, evaluations, PDF exports
      const updates = await Promise.all(
        manualSales.map(sale =>
          supabase
            .from('property_records')
            .update({
              sales_date: sale.sales_date,
              sales_price: sale.sales_price,
              sales_nu: sale.sales_nu,
              sales_book: sale.sales_book,
              sales_page: sale.sales_page,
              sales_override: true  // Mark so file update won't clobber this
            })
            .eq('job_id', jobData.id)
            .eq('property_block', sale.property_block)
            .eq('property_lot', sale.property_lot)
            .eq('property_qualifier', sale.property_qualifier)
        )
      );

      // Check for errors
      const errors = updates.filter(r => r.error);
      if (errors.length > 0) {
        throw new Error(errors[0].error.message);
      }

      console.log(`✅ Updated ${manualSales.length} properties in property_records with overrides`);
      setSaveResult({ success: true, count: manualSales.length });

      // Notify parent to reload just these properties from the DB
      onSaved?.(manualSales);

      setManualSales([]);
      setTimeout(() => {
        onClose();
      }, 500);
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
            Override junk sales with actual historical data. Select a property from the job and enter the better sale data.
          </p>

          {/* Property Selector */}
          <div className="bg-gray-50 border border-gray-200 rounded p-4 mb-6">
            <div className="mb-3">
              <label className="block text-xs font-semibold text-gray-700 mb-1">Select Property *</label>
              <div className="relative">
                <input
                  type="text"
                  value={selectedProperty ? `${selectedProperty.property_block}/${selectedProperty.property_lot}${selectedProperty.property_qualifier ? '-' + selectedProperty.property_qualifier : ''}` : searchText}
                  onChange={(e) => {
                    if (selectedProperty) {
                      setSelectedProperty(null);
                    }
                    setSearchText(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  placeholder="Search by block/lot (e.g. 39/9)"
                  disabled={saving}
                />
                {showDropdown && filteredProperties.length > 0 && (
                  <div className="absolute top-full left-0 right-0 border border-gray-300 border-t-0 rounded-b bg-white shadow-lg max-h-48 overflow-y-auto z-10">
                    {filteredProperties.map(prop => (
                      <button
                        key={`${prop.property_block}-${prop.property_lot}-${prop.property_qualifier}`}
                        onClick={() => {
                          setSelectedProperty(prop);
                          setSearchText('');
                          setShowDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm flex items-center justify-between"
                        type="button"
                      >
                        <span className="font-medium">
                          {prop.property_block}/{prop.property_lot}{prop.property_qualifier ? '-' + prop.property_qualifier : ''}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(prop.sales_date).toLocaleDateString()} • ${parseFloat(prop.sales_price || 0).toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Current Sale Info (if selected) */}
            {selectedProperty && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm">
                <span className="font-semibold text-red-900">Current Sale:</span>
                <span className="text-red-800 ml-2">
                  {new Date(selectedProperty.sales_date).toLocaleDateString()} • ${parseFloat(selectedProperty.sales_price || 0).toLocaleString()}
                </span>
              </div>
            )}

            {/* New Sale Data */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700">Sales Date *</label>
                <input
                  type="date"
                  value={salesDate}
                  onChange={(e) => setSalesDate(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  disabled={saving || !selectedProperty}
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
                  disabled={saving || !selectedProperty}
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
                  disabled={saving || !selectedProperty}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700">Book</label>
                <input
                  type="text"
                  value={salesBook}
                  onChange={(e) => setSalesBook(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  disabled={saving || !selectedProperty}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-700">Page</label>
                <input
                  type="text"
                  value={salesPage}
                  onChange={(e) => setSalesPage(e.target.value)}
                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  disabled={saving || !selectedProperty}
                />
              </div>
            </div>

            <button
              onClick={handleAddSale}
              className="px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
              disabled={saving || !selectedProperty}
            >
              Add Override
            </button>
          </div>

          {/* Overrides List */}
          {manualSales.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">
                {manualSales.length} override{manualSales.length !== 1 ? 's' : ''} to save
              </h3>
              <div className="space-y-2">
                {manualSales.map(sale => (
                  <div key={sale.tempId} className="bg-blue-50 border border-blue-200 rounded p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-gray-900">
                        {sale.property_block}/{sale.property_lot}{sale.property_qualifier ? '-' + sale.property_qualifier : ''}
                      </span>
                      <button
                        onClick={() => handleRemoveSale(sale.tempId)}
                        className="p-1 text-red-600 hover:bg-red-100 rounded"
                        disabled={saving}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="text-xs text-gray-600">
                      <div className="line-through">Old: {new Date(sale.current_sales_date).toLocaleDateString()} • ${parseFloat(sale.current_sales_price || 0).toLocaleString()}</div>
                      <div className="text-green-700 font-medium">New: {new Date(sale.sales_date).toLocaleDateString()} • ${sale.sales_price.toLocaleString()}</div>
                    </div>
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
