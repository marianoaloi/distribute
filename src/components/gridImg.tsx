import { useState } from "react"
import { selectMedias, useSelector } from "../lib/redux"
import { ImgGrid, Qtd, Resume } from "./gridImg.styled"
import { MediaIMG } from "./media"


export const GridIMGs = () => {

    const medias = useSelector(selectMedias)
    const [currentPage, setCurrentPage] = useState(0);
    const [postsPerPage, setPostsPerPage] = useState(20);
    return (
        <>
            <Resume>
                <Qtd>{medias.length}</Qtd>
                <select value={postsPerPage} onChange={(val) => setPostsPerPage(parseInt(val.currentTarget.value))}>
                    <option value="20">20</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                    <option value="200">200</option>
                    <option value="500">500</option>
                    <option value="1000">1000</option>
                </select>
                <Qtd>{currentPage + 1}/{Math.trunc(medias.length / postsPerPage)}</Qtd>
            </Resume>
            <ImgGrid>
                {medias.length > 0
                    ?
                    medias.slice(currentPage * postsPerPage, ((currentPage * postsPerPage) + postsPerPage)).map(media => <MediaIMG key={media.id} media={media} />)
                    : <h1>No Media</h1>
                }


            </ImgGrid></>)
}