"use client";

import { motion } from "framer-motion";
import { LucideIcon } from "lucide-react";

interface Props {
  title: string;
  value: number;
  color: string;
  icon: LucideIcon;
}

export default function DashboardCard({
  title,
  value,
  color,
  icon: Icon,
}: Props) {
  return (
    <motion.div
      whileHover={{ scale: 1.03 }}
      className={`rounded-2xl ${color} p-6 shadow-xl`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-gray-600">{title}</p>

          <h2 className="mt-2 text-4xl font-bold">
            {value}
          </h2>
        </div>

        <Icon className="h-12 w-12 opacity-80" />
      </div>
    </motion.div>
  );
}