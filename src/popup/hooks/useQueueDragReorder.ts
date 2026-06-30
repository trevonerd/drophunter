import { type DragEvent, useCallback, useState } from 'react';

export function useQueueDragReorder(onReorder: (fromIndex: number, toIndex: number) => void) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((index: number) => {
    return (event: DragEvent<HTMLButtonElement>) => {
      event.dataTransfer.setData('text/plain', String(index));
      event.dataTransfer.effectAllowed = 'move';
      setDragIndex(index);
    };
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropIndex(null);
  }, []);

  const handleDragOver = useCallback((index: number) => {
    return (event: DragEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropIndex(index);
    };
  }, []);

  const handleDrop = useCallback(
    (toIndex: number) => {
      return (event: DragEvent<HTMLSpanElement>) => {
        event.preventDefault();
        const fromIndex = Number(event.dataTransfer.getData('text/plain'));
        setDragIndex(null);
        setDropIndex(null);
        if (!Number.isInteger(fromIndex) || fromIndex === toIndex) {
          return;
        }
        onReorder(fromIndex, toIndex);
      };
    },
    [onReorder],
  );

  return {
    dragIndex,
    dropIndex,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDrop,
  };
}
