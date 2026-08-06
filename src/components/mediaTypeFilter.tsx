import { useState } from "react"
import { useDispatch } from "react-redux"
import { IconButton, Menu, MenuItem, ListItemIcon, ListItemText } from "@mui/material"
import { Gif, Movie, Image, AllInclusive } from "@mui/icons-material"
import { useSelector } from "../lib/redux"
import { configurationsSelector, setMediaType } from "../lib/redux/slices/configurations"
import { FilterBar } from "./mediaTypeFilter.styled"

export type MediaType = 'image' | 'video' | 'gif' | undefined

export function matchesMediaType(mime: string, mediaType: MediaType): boolean {
    if (!mediaType) return true;
    if (mediaType === 'gif') return mime.includes('gif');
    if (mediaType === 'video') return mime.includes('video');
    if (mediaType === 'image') return mime.includes('image') && !mime.includes('gif');
    return true;
}

export const MediaTypeFilter = (() => {

    const dispatch = useDispatch<any>();
    const config = useSelector(configurationsSelector)

    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const openMenu = Boolean(anchorEl);

    const handleClickFilter = (event: React.MouseEvent<HTMLButtonElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleCloseMenu = () => {
        setAnchorEl(null);
    };

    const handleSelectMediaType = (type: MediaType) => {
        dispatch(setMediaType(type));
        handleCloseMenu();
    };

    const getFilterIcon = () => {
        switch (config.mediaType) {
            case 'gif':
                return <Gif fontSize="medium" />;
            case 'video':
                return <Movie fontSize="medium" />;
            case 'image':
                return <Image fontSize="medium" />;
            default:
                return <AllInclusive fontSize="medium" />;
        }
    };

    return (
        <>
            <FilterBar>
                <IconButton
                    onClick={handleClickFilter}
                    color={config.mediaType ? "primary" : "default"}
                    title={`Filter: ${config.mediaType || 'All'}`}
                >
                    {getFilterIcon()}
                </IconButton>
            </FilterBar>
            <Menu
                anchorEl={anchorEl}
                open={openMenu}
                onClose={handleCloseMenu}
                sx={{ zIndex: 1001 }}
                anchorOrigin={{
                    vertical: 'top',
                    horizontal: 'left',
                }}
                transformOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right',
                }}
                slotProps={{
                    paper: {
                        sx: {
                            background: '#1e222b',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            color: '#fff',
                            '& .MuiMenuItem-root': {
                                gap: '10px',
                                padding: '8px 16px',
                                '&:hover': {
                                    background: 'rgba(255, 255, 255, 0.08)',
                                },
                                '&.Mui-selected': {
                                    background: 'rgba(25, 118, 210, 0.3)',
                                    '&:hover': {
                                        background: 'rgba(25, 118, 210, 0.4)',
                                    }
                                }
                            }
                        }
                    }
                }}
            >
                <MenuItem selected={config.mediaType === undefined} onClick={() => handleSelectMediaType(undefined)}>
                    <ListItemIcon><AllInclusive style={{ color: '#fff' }} /></ListItemIcon>
                    <ListItemText>All</ListItemText>
                </MenuItem>
                <MenuItem selected={config.mediaType === 'gif'} onClick={() => handleSelectMediaType('gif')}>
                    <ListItemIcon><Gif style={{ color: '#fff' }} /></ListItemIcon>
                    <ListItemText>GIF</ListItemText>
                </MenuItem>
                <MenuItem selected={config.mediaType === 'video'} onClick={() => handleSelectMediaType('video')}>
                    <ListItemIcon><Movie style={{ color: '#fff' }} /></ListItemIcon>
                    <ListItemText>Video</ListItemText>
                </MenuItem>
                <MenuItem selected={config.mediaType === 'image'} onClick={() => handleSelectMediaType('image')}>
                    <ListItemIcon><Image style={{ color: '#fff' }} /></ListItemIcon>
                    <ListItemText>Image</ListItemText>
                </MenuItem>
            </Menu>
        </>
    )
})
