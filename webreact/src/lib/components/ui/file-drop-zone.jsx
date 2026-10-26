"use client"

import * as React from "react"
import { cn } from "cn"
import { UploadIcon } from "lucide-react"
import { Portal } from "radix-ui"

/**
 * File drop zone context and utilities
 */

const FileDropZoneContext = React.createContext(null)

function useFileDropZoneContext() {
	const ctx = React.useContext(FileDropZoneContext)
	if (!ctx) {
		throw new Error("File drop zone component must be used within FileDropZone.Root")
	}
	return ctx
}

/**
 * Utility functions for file handling
 */

function getFiles(dataTransfer) {
	return Array.from(dataTransfer?.files ?? [])
}

function hasFiles(dataTransfer) {
	return dataTransfer?.types.includes("Files") ?? false
}

function displaySize(bytes) {
	const KILOBYTE = 1000
	const MEGABYTE = 1000 * KILOBYTE
	const GIGABYTE = 1000 * MEGABYTE

	if (bytes < KILOBYTE) return `${bytes.toFixed(0)} B`
	if (bytes < MEGABYTE) return `${(bytes / KILOBYTE).toFixed(0)} KB`
	if (bytes < GIGABYTE) return `${(bytes / MEGABYTE).toFixed(0)} MB`
	return `${(bytes / GIGABYTE).toFixed(0)} GB`
}

/**
 * File drop zone root component
 */

function FileDropZoneRoot({
	id,
	maxFiles,
	fileCount,
	maxFileSize,
	disabled = false,
	onUpload,
	onFileRejected,
	accept,
	capturePaste = false,
	children,
	...rest
}) {
	const inputRef = React.useRef(null)
	const [uploading, setUploading] = React.useState(false)
	const handledPasteEvents = React.useRef(new WeakSet())

	// Check configuration
	React.useEffect(() => {
		if (maxFiles !== undefined && fileCount === undefined) {
			console.warn(
				"Make sure to provide FileDropZone with `fileCount` when using the `maxFiles` prompt"
			)
		}
	}, [maxFiles, fileCount])

	const canUploadFiles = React.useMemo(() => {
		if (disabled) return false
		if (uploading) return false
		if (
			maxFiles !== undefined &&
			fileCount !== undefined &&
			fileCount >= maxFiles
		)
			return false
		return true
	}, [disabled, uploading, maxFiles, fileCount])

	const shouldAcceptFile = React.useCallback(
		(file, fileNumber) => {
			if (maxFileSize !== undefined && file.size > maxFileSize) {
				return "Maximum file size exceeded"
			}

			if (maxFiles !== undefined && fileNumber > maxFiles) {
				return "Maximum files uploaded"
			}

			if (!accept) return undefined

			const acceptedTypes = accept.split(",").map((a) => a.trim().toLowerCase())
			const fileType = file.type.toLowerCase()
			const fileName = file.name.toLowerCase()

			const isAcceptable = acceptedTypes.some((pattern) => {
				// check extension like .mp4
				if (fileType === "" || pattern.startsWith(".")) {
					return fileName.endsWith(pattern)
				}

				// if pattern has wild card like video/*
				if (pattern.endsWith("/*")) {
					const baseType = pattern.slice(0, pattern.indexOf("/*"))
					return fileType.startsWith(baseType + "/")
				}

				// otherwise it must be a specific type like video/mp4
				return fileType === pattern
			})

			if (!isAcceptable) return "File type not allowed"

			return undefined
		},
		[maxFileSize, maxFiles, accept]
	)

	const upload = React.useCallback(
		async (uploadFiles) => {
			setUploading(true)

			const validFiles = []

			for (let i = 0; i < uploadFiles.length; i++) {
				const file = uploadFiles[i]

				const rejectedReason = shouldAcceptFile(
					file,
					(fileCount ?? 0) + i + 1
				)

				if (rejectedReason) {
					onFileRejected?.({ file, reason: rejectedReason })
					continue
				}

				validFiles.push(file)
			}

			await onUpload?.(validFiles)

			setUploading(false)
		},
		[fileCount, shouldAcceptFile, onUpload, onFileRejected]
	)

	const handleChange = React.useCallback(
		async (e) => {
			if (disabled) return

			const selectedFiles = e.currentTarget.files
			if (!selectedFiles) return

			await upload(Array.from(selectedFiles))

			// Reset input so we can upload the same file again
			e.target.value = ""
		},
		[disabled, upload]
	)

	const handleDrop = React.useCallback(
		async (e) => {
			if (disabled || !canUploadFiles) return

			e.preventDefault()

			const droppedFiles = getFiles(e.dataTransfer)
			await upload(droppedFiles)
		},
		[disabled, canUploadFiles, upload]
	)

	const handlePaste = React.useCallback(
		async (e) => {
			if (disabled || !canUploadFiles) return

			if (handledPasteEvents.current.has(e)) return

			handledPasteEvents.current.add(e)

			const pastedFiles = getFiles(e.clipboardData)

			if (pastedFiles.length === 0) return

			await upload(pastedFiles)
		},
		[disabled, canUploadFiles, upload]
	)

	// Set up document paste listener if enabled
	React.useEffect(() => {
		if (!capturePaste) return

		document.addEventListener("paste", handlePaste)
		return () => document.removeEventListener("paste", handlePaste)
	}, [capturePaste, handlePaste])

	const inputProps = React.useMemo(
		() => ({
			disabled: !canUploadFiles,
			id,
			accept,
			multiple:
				maxFiles === undefined || maxFiles - (fileCount ?? 0) > 1,
			type: "file",
			onChange: handleChange,
		}),
		[canUploadFiles, id, accept, maxFiles, fileCount, handleChange]
	)

	const state = React.useMemo(
		() => ({
			uploading,
			canUploadFiles,
			inputRef,
			inputProps,
			handleDrop,
			handlePaste,
			maxFiles,
			fileCount,
			maxFileSize,
		}),
		[uploading, canUploadFiles, inputProps, handleDrop, handlePaste, maxFiles, fileCount, maxFileSize]
	)

	return (
		<FileDropZoneContext.Provider value={state}>
			<input
				ref={inputRef}
				className="hidden"
				{...inputProps}
				{...rest}
			/>
			{children}
		</FileDropZoneContext.Provider>
	)
}

/**
 * File drop zone trigger component
 */

function FileDropZoneTrigger({
	ref,
	className,
	children,
	...rest
}) {
	const { canUploadFiles, inputProps, handleDrop, maxFiles, fileCount, maxFileSize } = useFileDropZoneContext()

	const handleDragOver = React.useCallback((e) => {
		e.preventDefault()
	}, [])

	const handleDropInternal = React.useCallback((e) => {
		handleDrop(e)
	}, [handleDrop])

	return (
		<label
			ref={ref}
			className={cn("group/file-drop-zone-trigger", className)}
			htmlFor={inputProps.id}
			onDragOver={handleDragOver}
			onDrop={handleDropInternal}
			aria-disabled={!canUploadFiles}
			{...rest}
		>
			{children ? (
				children
			) : (
				<div className="hover:bg-accent/25 flex h-48 flex-col place-items-center justify-center gap-2 rounded-lg border border-dashed p-6 transition-all group-aria-disabled/file-drop-zone-trigger:opacity-50 hover:cursor-pointer group-aria-disabled/file-drop-zone-trigger:hover:cursor-not-allowed">
					<div className="border-border text-muted-foreground flex size-14 place-items-center justify-center rounded-full border border-dashed">
						<UploadIcon className="size-7" />
					</div>
					<div className="flex flex-col gap-0.5 text-center">
						<span className="text-muted-foreground font-medium">
							Drag 'n' drop files here, or click to select files
						</span>
						{maxFiles !== undefined || maxFileSize !== undefined ? (
							<span className="text-muted-foreground/75 text-sm">
								{maxFiles !== undefined && (
									<span>
										You can upload {maxFiles} files
									</span>
								)}
								{maxFiles !== undefined && maxFileSize !== undefined && (
									<span>
										{" "}(up to {displaySize(maxFileSize)} each)
									</span>
								)}
								{maxFileSize !== undefined && maxFiles === undefined && (
									<span>
										Maximum size {displaySize(maxFileSize)}
									</span>
								)}
							</span>
						) : null}
					</div>
				</div>
			)}
		</label>
	)
}

/**
 * File drop zone drag overlay component
 */

function FileDropZoneDragOverlay({
	ref,
	className,
	disabled = false,
	portalProps,
	children,
	...rest
}) {
	const { canUploadFiles, handleDrop } = useFileDropZoneContext()
	const [dragDepth, setDragDepth] = React.useState(0)
	const dragDepthRef = React.useRef(0)

	const isDragging = dragDepth > 0 && canUploadFiles && !disabled

	const handleWindowDragEnter = React.useCallback((e) => {
		if (!hasFiles(e.dataTransfer)) return
		dragDepthRef.current++
		setDragDepth(dragDepthRef.current)
	}, [])

	const handleWindowDragLeave = React.useCallback((e) => {
		if (!hasFiles(e.dataTransfer)) return
		dragDepthRef.current = Math.max(dragDepthRef.current - 1, 0)
		setDragDepth(dragDepthRef.current)
	}, [])

	const handleWindowDragOver = React.useCallback((e) => {
		if (dragDepthRef.current === 0 || !canUploadFiles || disabled) return
		e.preventDefault()
	}, [canUploadFiles, disabled])

	const handleWindowDrop = React.useCallback(() => {
		dragDepthRef.current = 0
		setDragDepth(0)
	}, [])

	const handleWindowDragEnd = React.useCallback(() => {
		dragDepthRef.current = 0
		setDragDepth(0)
	}, [])

	const handleOverlayDragOver = React.useCallback((e) => {
		if (!isDragging) return
		e.preventDefault()
	}, [isDragging])

	const handleOverlayDrop = React.useCallback(
		(e) => {
			dragDepthRef.current = 0
			setDragDepth(0)
			if (disabled || !canUploadFiles) return
			handleDrop(e)
		},
		[disabled, canUploadFiles, handleDrop]
	)

	// Set up window event listeners
	React.useEffect(() => {
		window.addEventListener("dragenter", handleWindowDragEnter)
		window.addEventListener("dragleave", handleWindowDragLeave)
		window.addEventListener("dragover", handleWindowDragOver)
		window.addEventListener("drop", handleWindowDrop)
		window.addEventListener("dragend", handleWindowDragEnd)

		return () => {
			window.removeEventListener("dragenter", handleWindowDragEnter)
			window.removeEventListener("dragleave", handleWindowDragLeave)
			window.removeEventListener("dragover", handleWindowDragOver)
			window.removeEventListener("drop", handleWindowDrop)
			window.removeEventListener("dragend", handleWindowDragEnd)
		}
	}, [handleWindowDragEnter, handleWindowDragLeave, handleWindowDragOver, handleWindowDrop, handleWindowDragEnd])

	if (!isDragging) return null

	return (
		<Portal {...portalProps}>
			<div
				ref={ref}
				className={cn(
					"animate-in fade-in-0 fixed inset-0 z-50 flex place-items-center justify-center bg-black/25 p-6 duration-100 supports-backdrop-filter:backdrop-blur-xs",
					className
				)}
				onDragOver={handleOverlayDragOver}
				onDrop={handleOverlayDrop}
				{...rest}
			>
				{children ? (
					children
				) : (
					<div className="text-foreground flex flex-col place-items-center justify-center gap-3">
						<UploadIcon className="size-8" />
						<span className="text-lg font-medium">Drop files here to upload</span>
					</div>
				)}
			</div>
		</Portal>
	)
}

/**
 * File drop zone textarea component
 */

function FileDropZoneTextarea({
	onPaste,
	onDragOver,
	onDrop,
	...rest
}) {
	const { handleDrop, handlePaste } = useFileDropZoneContext()

	const handleDragOverInternal = React.useCallback((e) => {
		e.preventDefault()
		onDragOver?.(e)
	}, [onDragOver])

	const handleDropInternal = React.useCallback((e) => {
		handleDrop(e)
		onDrop?.(e)
	}, [handleDrop, onDrop])

	const handlePasteInternal = React.useCallback((e) => {
		handlePaste(e)
		onPaste?.(e)
	}, [handlePaste, onPaste])

	return (
		<textarea
			onDragOver={handleDragOverInternal}
			onDrop={handleDropInternal}
			onPaste={handlePasteInternal}
			{...rest}
		/>
	)
}

/**
 * Compound component exports
 */

const FileDropZone = Object.assign(FileDropZoneRoot, {
	Root: FileDropZoneRoot,
	Trigger: FileDropZoneTrigger,
	DragOverlay: FileDropZoneDragOverlay,
	Textarea: FileDropZoneTextarea,
})

export const BYTE = 1
const KILOBYTE = 1000
const MEGABYTE = 1000 * 1000
const GIGABYTE = 1000 * 1000 * 1000
export const ACCEPT_IMAGE = "image/*"
export const ACCEPT_VIDEO = "video/*"
export const ACCEPT_AUDIO = "audio/*"

export {
	FileDropZone,
	FileDropZoneRoot,
	FileDropZoneTrigger,
	FileDropZoneDragOverlay,
	FileDropZoneTextarea,
	displaySize,
}
