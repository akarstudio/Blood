import React from 'react';

interface StatusBadgeProps {
  status: string;
  type?: 'approval' | 'verification' | 'availability' | 'account';
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, type = 'approval', size = 'md' }) => {
  let label = status;
  let dotColor = 'bg-slate-400';
  let textColor = 'text-slate-600';

  switch (status.toLowerCase()) {
    case 'approved':
    case 'verified':
    case 'available':
    case 'active':
      label = status.charAt(0).toUpperCase() + status.slice(1);
      dotColor = 'bg-emerald-600';
      textColor = 'text-emerald-800';
      break;
    case 'pending':
      label = 'Pending Review';
      dotColor = 'bg-amber-500';
      textColor = 'text-amber-800';
      break;
    case 'unverified':
      label = 'Unverified';
      dotColor = 'bg-amber-400';
      textColor = 'text-amber-700';
      break;
    case 'unavailable':
      label = 'Unavailable';
      dotColor = 'bg-rose-500';
      textColor = 'text-rose-700';
      break;
    case 'rejected':
      label = 'Rejected';
      dotColor = 'bg-rose-600';
      textColor = 'text-rose-800';
      break;
    case 'suspended':
      label = 'Suspended';
      dotColor = 'bg-rose-700';
      textColor = 'text-rose-900';
      break;
    case 'deactivated':
      label = 'Deactivated';
      dotColor = 'bg-slate-400';
      textColor = 'text-slate-500';
      break;
    default:
      label = status;
  }

  const textSize = size === 'sm' ? 'text-xs' : 'text-xs font-medium';

  return (
    <span className={`inline-flex items-center gap-1.5 ${textSize} ${textColor}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor} shrink-0`} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
};
