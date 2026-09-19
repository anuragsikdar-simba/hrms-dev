'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import type { LucideIcon } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Color variants                                                     */
/* ------------------------------------------------------------------ */

const colorVariants = {
  blue: {
    icon: 'bg-blue-100 text-blue-600',
    trend: 'text-blue-600',
  },
  green: {
    icon: 'bg-green-100 text-green-600',
    trend: 'text-green-600',
  },
  red: {
    icon: 'bg-red-100 text-red-600',
    trend: 'text-red-600',
  },
  yellow: {
    icon: 'bg-yellow-100 text-yellow-600',
    trend: 'text-yellow-600',
  },
  purple: {
    icon: 'bg-purple-100 text-purple-600',
    trend: 'text-purple-600',
  },
  orange: {
    icon: 'bg-orange-100 text-orange-600',
    trend: 'text-orange-600',
  },
  gray: {
    icon: 'bg-gray-100 text-gray-600',
    trend: 'text-gray-600',
  },
} as const;

export type StatCardColor = keyof typeof colorVariants;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export interface StatCardProps {
  /** Lucide icon component */
  icon: LucideIcon;
  /** Description label */
  label: string;
  /** Main display value */
  value: string | number;
  /** Optional trend/change text (e.g. "+5% from last month") */
  trend?: string;
  /** Optional trend direction for styling */
  trendDirection?: 'up' | 'down' | 'neutral';
  /** Color variant */
  color?: StatCardColor;
  /** Click handler or link behavior */
  onClick?: () => void;
  /** Additional class names */
  className?: string;
}

export function StatCard({
  icon: Icon,
  label,
  value,
  trend,
  trendDirection = 'neutral',
  color = 'blue',
  onClick,
  className,
}: StatCardProps) {
  const colors = colorVariants[color];
  const isClickable = !!onClick;

  const trendColor =
    trendDirection === 'up'
      ? 'text-green-600'
      : trendDirection === 'down'
        ? 'text-red-600'
        : 'text-gray-500';

  return (
    <Card
      className={cn(
        'relative overflow-hidden transition-all duration-200',
        isClickable &&
          'cursor-pointer hover:shadow-md hover:-translate-y-0.5 active:translate-y-0',
        className,
      )}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-500 truncate">
              {label}
            </p>
            <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
            {trend && (
              <p className={cn('mt-1 text-xs font-medium', trendColor)}>
                {trend}
              </p>
            )}
          </div>
          <div
            className={cn(
              'flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-xl',
              colors.icon,
            )}
          >
            <Icon className="h-6 w-6" />
          </div>
        </div>
      </div>
    </Card>
  );
}
